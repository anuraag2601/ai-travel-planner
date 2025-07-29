import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { performance } from 'perf_hooks';

// Import services for error handling testing
import { AmadeusService } from '../../services/external/amadeusService.js';
import { ClaudeService } from '../../services/external/claudeService.js';
import { FirebaseService } from '../../services/external/firebaseService.js';

// Circuit breaker implementation for testing
class CircuitBreaker {
  private failures = 0;
  private nextAttempt = Date.now();
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000,
    private monitor?: (state: string) => void
  ) {}

  async call<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
      this.monitor?.('HALF_OPEN');
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.monitor?.('CLOSED');
  }

  private onFailure() {
    this.failures++;
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      this.monitor?.('OPEN');
    }
  }

  getState() {
    return this.state;
  }

  getFailures() {
    return this.failures;
  }
}

// Retry mechanism with exponential backoff
class RetryHandler {
  constructor(
    private maxRetries: number = 3,
    private baseDelay: number = 1000,
    private maxDelay: number = 10000
  ) {}

  async execute<T>(
    operation: () => Promise<T>,
    retryableErrors: string[] = ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT']
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === this.maxRetries) {
          throw lastError;
        }

        // Check if error is retryable
        const isRetryable = retryableErrors.some(retryableError => 
          lastError.message.includes(retryableError)
        );

        if (!isRetryable) {
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.baseDelay * Math.pow(2, attempt),
          this.maxDelay
        );

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}

// Fallback handler for service degradation
class FallbackHandler {
  constructor(
    private fallbackStrategies: Map<string, () => Promise<any>> = new Map()
  ) {}

  registerFallback(serviceName: string, fallbackFn: () => Promise<any>) {
    this.fallbackStrategies.set(serviceName, fallbackFn);
  }

  async executeWithFallback<T>(
    serviceName: string,
    primaryOperation: () => Promise<T>
  ): Promise<T> {
    try {
      return await primaryOperation();
    } catch (error) {
      const fallback = this.fallbackStrategies.get(serviceName);
      if (fallback) {
        console.warn(`Primary service ${serviceName} failed, using fallback`);
        return await fallback();
      }
      throw error;
    }
  }
}

describe('Error Handling and Recovery Testing', () => {
  let amadeusService: AmadeusService;
  let claudeService: ClaudeService;
  let firebaseService: FirebaseService;
  let circuitBreaker: CircuitBreaker;
  let retryHandler: RetryHandler;
  let fallbackHandler: FallbackHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    amadeusService = new AmadeusService();
    claudeService = new ClaudeService();
    firebaseService = new FirebaseService();
    circuitBreaker = new CircuitBreaker(3, 30000);
    retryHandler = new RetryHandler(3, 500, 5000);
    fallbackHandler = new FallbackHandler();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Circuit Breaker Pattern', () => {
    it('should open circuit after threshold failures', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      const monitor = jest.fn();
      const breaker = new CircuitBreaker(3, 5000, monitor);

      // Cause 3 failures to open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.call(failingOperation);
        } catch (error) {
          // Expected failure
        }
      }

      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.getFailures()).toBe(3);
      expect(monitor).toHaveBeenCalledWith('OPEN');

      // Next call should fail immediately without calling operation
      await expect(breaker.call(failingOperation)).rejects.toThrow('Circuit breaker is OPEN');
      expect(failingOperation).toHaveBeenCalledTimes(3); // Should not be called again
    });

    it('should transition to half-open after timeout', async () => {
      const failingOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      const monitor = jest.fn();
      const breaker = new CircuitBreaker(2, 100, monitor); // Short timeout for testing

      // Open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.call(failingOperation);
        } catch (error) {
          // Expected failure
        }
      }

      expect(breaker.getState()).toBe('OPEN');

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Mock successful operation
      const successfulOperation = jest.fn().mockResolvedValue('success');

      // Next call should transition to half-open, then closed on success
      const result = await breaker.call(successfulOperation);

      expect(result).toBe('success');
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getFailures()).toBe(0);
      expect(monitor).toHaveBeenCalledWith('HALF_OPEN');
      expect(monitor).toHaveBeenCalledWith('CLOSED');
    });

    it('should handle Amadeus API with circuit breaker', async () => {
      const mockAmadeusClient = {
        shopping: {
          flightOffersSearch: {
            get: jest.fn()
              .mockRejectedValueOnce(new Error('RATE_LIMIT'))
              .mockRejectedValueOnce(new Error('SERVICE_UNAVAILABLE'))
              .mockRejectedValueOnce(new Error('TIMEOUT'))
              .mockResolvedValueOnce({
                data: [{ id: 'flight-1', price: { total: '500' } }]
              })
          }
        }
      };

      // Mock the Amadeus client
      amadeusService['client'] = mockAmadeusClient as any;

      const searchWithCircuitBreaker = async () => {
        return await circuitBreaker.call(async () => {
          return await amadeusService.searchFlights({
            origin: 'JFK',
            destination: 'CDG',
            departureDate: '2024-12-25',
            adults: 2,
            children: 0,
            travelClass: 'ECONOMY'
          });
        });
      };

      // First 3 attempts should fail and open circuit
      for (let i = 0; i < 3; i++) {
        try {
          await searchWithCircuitBreaker();
        } catch (error) {
          expect(error.message).toMatch(/RATE_LIMIT|SERVICE_UNAVAILABLE|TIMEOUT/);
        }
      }

      expect(circuitBreaker.getState()).toBe('OPEN');

      // Wait for circuit to allow half-open
      await new Promise(resolve => setTimeout(resolve, 100));

      // This should fail immediately due to circuit being open
      await expect(searchWithCircuitBreaker()).rejects.toThrow('Circuit breaker is OPEN');
    });
  });

  describe('Retry Mechanisms with Exponential Backoff', () => {
    it('should retry operations with exponential backoff', async () => {
      const failingOperation = jest.fn()
        .mockRejectedValueOnce(new Error('NETWORK_ERROR'))
        .mockRejectedValueOnce(new Error('TIMEOUT'))
        .mockResolvedValueOnce('success');

      const startTime = performance.now();
      const result = await retryHandler.execute(failingOperation);
      const endTime = performance.now();

      expect(result).toBe('success');
      expect(failingOperation).toHaveBeenCalledTimes(3);
      
      // Should have taken time for retries (base delay + exponential backoff)
      expect(endTime - startTime).toBeGreaterThan(1500); // 500ms + 1000ms delays
    });

    it('should not retry non-retryable errors', async () => {
      const failingOperation = jest.fn()
        .mockRejectedValue(new Error('VALIDATION_ERROR'));

      await expect(retryHandler.execute(failingOperation)).rejects.toThrow('VALIDATION_ERROR');
      expect(failingOperation).toHaveBeenCalledTimes(1); // Should not retry
    });

    it('should handle Claude AI service with retry logic', async () => {
      const mockAnthropicClient = {
        messages: {
          create: jest.fn()
            .mockRejectedValueOnce(new Error('RATE_LIMIT: Too many requests'))
            .mockRejectedValueOnce(new Error('TIMEOUT: Request timed out'))
            .mockResolvedValueOnce({
              content: [{
                type: 'text',
                text: JSON.stringify({
                  id: 'itinerary-123',
                  overview: { title: 'Test Itinerary' },
                  dailyItinerary: []
                })
              }],
              usage: { input_tokens: 1000, output_tokens: 500 }
            })
        }
      };

      // Mock Redis for caching
      const mockRedisService = {
        get: jest.fn().mockResolvedValue(null),
        setex: jest.fn().mockResolvedValue('OK')
      };

      claudeService['client'] = mockAnthropicClient as any;
      claudeService['redis'] = mockRedisService as any;

      const generateWithRetry = async () => {
        return await retryHandler.execute(async () => {
          return await claudeService.generateItinerary({
            destination: 'Paris, France',
            duration: 3,
            startDate: '2024-12-25',
            endDate: '2024-12-27',
            travelers: { adults: 2, children: 0 },
            budget: { total: 2000, currency: 'USD' },
            preferences: {
              interests: ['culture'],
              pace: 'moderate',
              accommodationType: 'hotel',
              diningPreferences: ['local cuisine'],
              activityTypes: ['sightseeing'],
              accessibility: { wheelchair: false, mobility: 'full' }
            },
            constraints: {
              avoidAreas: [],
              mustVisit: [],
              budgetConstraints: { maxMealCost: 50, maxActivityCost: 100 }
            }
          });
        }, ['RATE_LIMIT', 'TIMEOUT']);
      };

      const result = await generateWithRetry();

      expect(result.id).toBe('itinerary-123');
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(3);
    });

    it('should respect maximum retry attempts and max delay', async () => {
      const alwaysFailingOperation = jest.fn()
        .mockRejectedValue(new Error('NETWORK_ERROR'));

      const handler = new RetryHandler(2, 100, 500); // 2 retries, short delays
      const startTime = performance.now();

      await expect(handler.execute(alwaysFailingOperation)).rejects.toThrow('NETWORK_ERROR');
      
      const endTime = performance.now();
      
      expect(alwaysFailingOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
      
      // Should have taken time for retries but respect max delay
      expect(endTime - startTime).toBeGreaterThan(300); // At least base delays
      expect(endTime - startTime).toBeLessThan(1000); // But not too long
    });
  });

  describe('Fallback Strategies', () => {
    it('should use fallback when primary service fails', async () => {
      const primaryOperation = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      const fallbackOperation = jest.fn().mockResolvedValue('fallback result');

      fallbackHandler.registerFallback('test-service', fallbackOperation);

      const result = await fallbackHandler.executeWithFallback('test-service', primaryOperation);

      expect(result).toBe('fallback result');
      expect(primaryOperation).toHaveBeenCalledTimes(1);
      expect(fallbackOperation).toHaveBeenCalledTimes(1);
    });

    it('should implement flight search fallback strategy', async () => {
      // Setup failing primary Amadeus service
      const mockAmadeusClient = {
        shopping: {
          flightOffersSearch: {
            get: jest.fn().mockRejectedValue(new Error('Amadeus API unavailable'))
          }
        }
      };

      amadeusService['client'] = mockAmadeusClient as any;

      // Register fallback strategy
      fallbackHandler.registerFallback('flight-search', async () => {
        return {
          data: [{
            id: 'fallback-flight-1',
            price: { currency: 'USD', total: '599.00', grandTotal: '599.00' },
            itineraries: [{
              duration: 'PT8H30M',
              segments: [{
                departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
                arrival: { iataCode: 'CDG', at: '2024-12-25T23:30:00' },
                carrierCode: 'FALLBACK',
                number: '001'
              }]
            }]
          }],
          meta: { count: 1, source: 'fallback' },
          dictionaries: { carriers: { 'FALLBACK': 'Fallback Airlines' } }
        };
      });

      const searchWithFallback = async () => {
        return await fallbackHandler.executeWithFallback('flight-search', async () => {
          return await amadeusService.searchFlights({
            origin: 'JFK',
            destination: 'CDG',
            departureDate: '2024-12-25',
            adults: 2,
            children: 0,
            travelClass: 'ECONOMY'
          });
        });
      };

      const result = await searchWithFallback();

      expect(result.data[0].id).toBe('fallback-flight-1');
      expect(result.meta.source).toBe('fallback');
      expect(mockAmadeusClient.shopping.flightOffersSearch.get).toHaveBeenCalledTimes(1);
    });

    it('should implement itinerary generation fallback with simplified template', async () => {
      // Setup failing Claude service
      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockRejectedValue(new Error('Claude API unavailable'))
        }
      };

      claudeService['client'] = mockAnthropicClient as any;

      // Register fallback strategy with simplified itinerary
      fallbackHandler.registerFallback('itinerary-generation', async () => {
        return {
          id: `fallback-itinerary-${Date.now()}`,
          overview: {
            title: 'Basic Travel Itinerary',
            description: 'Simplified itinerary due to service limitations',
            highlights: ['Popular attractions', 'Local restaurants', 'Transportation options'],
            themes: ['Essential travel']
          },
          totalBudget: {
            estimated: 2000,
            currency: 'USD',
            breakdown: {
              accommodation: 800,
              activities: 600,
              food: 400,
              transportation: 200
            },
            confidence: 0.6
          },
          dailyItinerary: [{
            day: 1,
            date: '2024-12-25',
            theme: 'City Exploration',
            location: 'City Center',
            activities: [{
              time: '10:00',
              duration: 180,
              type: 'sightseeing',
              title: 'City Walking Tour',
              description: 'Explore the main attractions on foot',
              location: { name: 'City Center', address: 'Main Square' },
              cost: { amount: 20, currency: 'USD', priceType: 'estimated' },
              bookingInfo: { required: false },
              accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
              tips: ['Wear comfortable shoes', 'Bring water'],
              alternatives: ['Bus tour', 'Bike tour']
            }],
            meals: [{
              time: '13:00',
              type: 'lunch',
              restaurant: {
                name: 'Local Restaurant',
                cuisine: 'Local',
                location: 'City Center',
                priceRange: '$$',
                atmosphere: 'Casual dining'
              },
              estimatedCost: { amount: 25, currency: 'USD' },
              reservationInfo: { required: false },
              highlights: ['Local specialties'],
              dietaryOptions: ['Vegetarian options available']
            }],
            transportation: [],
            dailyBudget: {
              estimated: 100,
              breakdown: {
                activities: 20,
                food: 50,
                transportation: 20,
                miscellaneous: 10
              }
            },
            tips: ['Start early', 'Check weather'],
            alternatives: []
          }],
          generationMetadata: {
            model: 'fallback-template',
            confidence: 0.6,
            tokensUsed: 0,
            generatedAt: new Date().toISOString(),
            version: '1.0'
          }
        };
      });

      const generateWithFallback = async () => {
        return await fallbackHandler.executeWithFallback('itinerary-generation', async () => {
          return await claudeService.generateItinerary({
            destination: 'Paris, France',
            duration: 3,
            startDate: '2024-12-25',
            endDate: '2024-12-27',
            travelers: { adults: 2, children: 0 },
            budget: { total: 2000, currency: 'USD' },
            preferences: {
              interests: ['culture'],
              pace: 'moderate',
              accommodationType: 'hotel',
              diningPreferences: ['local cuisine'],
              activityTypes: ['sightseeing'],
              accessibility: { wheelchair: false, mobility: 'full' }
            },
            constraints: {
              avoidAreas: [],
              mustVisit: [],
              budgetConstraints: { maxMealCost: 50, maxActivityCost: 100 }
            }
          });
        });
      };

      const result = await generateWithFallback();

      expect(result.overview.title).toBe('Basic Travel Itinerary');
      expect(result.generationMetadata.model).toBe('fallback-template');
      expect(result.generationMetadata.confidence).toBe(0.6);
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('Service Health Monitoring and Recovery', () => {
    it('should monitor service health and implement graceful degradation', async () => {
      const healthChecks = new Map<string, boolean>();
      const serviceStates = new Map<string, 'healthy' | 'degraded' | 'unhealthy'>();

      const healthMonitor = {
        checkHealth: async (serviceName: string): Promise<boolean> => {
          const mockHealthChecks = {
            'amadeus': Math.random() > 0.3, // 70% healthy
            'claude': Math.random() > 0.2,  // 80% healthy
            'firebase': Math.random() > 0.1  // 90% healthy
          };
          
          const isHealthy = mockHealthChecks[serviceName as keyof typeof mockHealthChecks] ?? true;
          healthChecks.set(serviceName, isHealthy);
          
          // Determine service state
          const previousFailures = serviceStates.get(serviceName + '_failures') as any || 0;
          if (isHealthy) {
            serviceStates.set(serviceName, 'healthy');
            serviceStates.set(serviceName + '_failures', 0);
          } else {
            const failures = previousFailures + 1;
            serviceStates.set(serviceName + '_failures', failures);
            
            if (failures >= 3) {
              serviceStates.set(serviceName, 'unhealthy');
            } else {
              serviceStates.set(serviceName, 'degraded');
            }
          }
          
          return isHealthy;
        },

        getServiceState: (serviceName: string) => {
          return serviceStates.get(serviceName) || 'healthy';
        },

        handleDegradedService: async (serviceName: string) => {
          const state = serviceStates.get(serviceName);
          
          switch (state) {
            case 'degraded':
              // Implement retry with longer delays
              return { strategy: 'retry_with_backoff', delay: 5000 };
            case 'unhealthy':
              // Use fallback service
              return { strategy: 'use_fallback' };
            default:
              return { strategy: 'normal_operation' };
          }
        }
      };

      // Simulate health checks for multiple services
      const services = ['amadeus', 'claude', 'firebase'];
      const healthResults = await Promise.all(
        services.map(service => healthMonitor.checkHealth(service))
      );

      // Check that health monitoring works
      expect(healthResults).toHaveLength(3);
      healthResults.forEach(result => {
        expect(typeof result).toBe('boolean');
      });

      // Test degradation handling
      for (const service of services) {
        const strategy = await healthMonitor.handleDegradedService(service);
        expect(strategy.strategy).toMatch(/normal_operation|retry_with_backoff|use_fallback/);
      }
    });

    it('should implement timeout handling for external services', async () => {
      const timeoutHandler = {
        withTimeout: async <T>(
          operation: () => Promise<T>,
          timeoutMs: number,
          serviceName: string
        ): Promise<T> => {
          return new Promise<T>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error(`${serviceName} operation timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            operation()
              .then(result => {
                clearTimeout(timeoutId);
                resolve(result);
              })
              .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
              });
          });
        }
      };

      // Test timeout with slow operation
      const slowOperation = () => new Promise(resolve => 
        setTimeout(() => resolve('completed'), 2000)
      );

      // Should timeout after 1 second
      await expect(
        timeoutHandler.withTimeout(slowOperation, 1000, 'test-service')
      ).rejects.toThrow('test-service operation timed out after 1000ms');

      // Test timeout with fast operation
      const fastOperation = () => Promise.resolve('fast result');

      const result = await timeoutHandler.withTimeout(fastOperation, 1000, 'test-service');
      expect(result).toBe('fast result');
    });

    it('should handle cascading failures gracefully', async () => {
      const cascadeHandler = {
        services: new Map<string, { status: string, dependencies: string[] }>([
          ['database', { status: 'healthy', dependencies: [] }],
          ['cache', { status: 'healthy', dependencies: ['database'] }],
          ['auth', { status: 'healthy', dependencies: ['database'] }],
          ['search', { status: 'healthy', dependencies: ['database', 'cache', 'amadeus'] }],
          ['amadeus', { status: 'healthy', dependencies: [] }],
          ['claude', { status: 'healthy', dependencies: [] }],
          ['api', { status: 'healthy', dependencies: ['auth', 'search', 'claude'] }]
        ]),

        simulateFailure: function(serviceName: string) {
          const service = this.services.get(serviceName);
          if (service) {
            service.status = 'failed';
            this.propagateFailure(serviceName);
          }
        },

        propagateFailure: function(failedService: string) {
          for (const [serviceName, service] of this.services.entries()) {
            if (service.dependencies.includes(failedService) && service.status !== 'failed') {
              service.status = 'degraded';
            }
          }
        },

        getSystemHealth: function() {
          const healthy = Array.from(this.services.values()).filter(s => s.status === 'healthy').length;
          const degraded = Array.from(this.services.values()).filter(s => s.status === 'degraded').length;
          const failed = Array.from(this.services.values()).filter(s => s.status === 'failed').length;
          
          return { healthy, degraded, failed, total: this.services.size };
        }
      };

      // Initial state - all healthy
      let health = cascadeHandler.getSystemHealth();
      expect(health.healthy).toBe(7);
      expect(health.degraded).toBe(0);
      expect(health.failed).toBe(0);

      // Simulate database failure
      cascadeHandler.simulateFailure('database');

      // Check cascade effect
      health = cascadeHandler.getSystemHealth();
      expect(health.failed).toBe(1); // database
      expect(health.degraded).toBeGreaterThan(0); // dependent services

      // Verify specific services are affected
      expect(cascadeHandler.services.get('database')?.status).toBe('failed');
      expect(cascadeHandler.services.get('cache')?.status).toBe('degraded');
      expect(cascadeHandler.services.get('auth')?.status).toBe('degraded');
      expect(cascadeHandler.services.get('search')?.status).toBe('degraded');
    });
  });

  describe('Data Consistency and Recovery', () => {
    it('should handle partial data corruption and recovery', async () => {
      const dataRecovery = {
        validateData: (data: any): { isValid: boolean; errors: string[] } => {
          const errors: string[] = [];
          
          if (!data) {
            errors.push('Data is null or undefined');
            return { isValid: false, errors };
          }

          if (typeof data !== 'object') {
            errors.push('Data is not an object');
          }

          if (data.itinerary) {
            if (!data.itinerary.id || typeof data.itinerary.id !== 'string') {
              errors.push('Invalid itinerary ID');
            }
            
            if (!data.itinerary.dailyItinerary || !Array.isArray(data.itinerary.dailyItinerary)) {
              errors.push('Invalid daily itinerary structure');
            }
            
            if (data.itinerary.totalBudget && typeof data.itinerary.totalBudget.estimated !== 'number') {
              errors.push('Invalid budget estimation');
            }
          }

          return { isValid: errors.length === 0, errors };
        },

        repairData: (corruptedData: any): any => {
          const repaired = { ...corruptedData };

          // Repair missing ID
          if (!repaired.itinerary?.id) {
            repaired.itinerary = repaired.itinerary || {};
            repaired.itinerary.id = `recovered-${Date.now()}`;
          }

          // Repair missing daily itinerary
          if (!repaired.itinerary?.dailyItinerary) {
            repaired.itinerary.dailyItinerary = [];
          }

          // Repair budget issues
          if (repaired.itinerary?.totalBudget && typeof repaired.itinerary.totalBudget.estimated !== 'number') {
            repaired.itinerary.totalBudget.estimated = 0;
          }

          return repaired;
        },

        recoverFromBackup: async (dataId: string): Promise<any> => {
          // Simulate backup recovery
          return {
            itinerary: {
              id: dataId,
              overview: { title: 'Recovered Itinerary' },
              dailyItinerary: [],
              totalBudget: { estimated: 1000, currency: 'USD' },
              generationMetadata: {
                model: 'recovered',
                confidence: 0.5,
                tokensUsed: 0,
                generatedAt: new Date().toISOString(),
                version: '1.0'
              }
            }
          };
        }
      };

      // Test with corrupted data
      const corruptedData = {
        itinerary: {
          // Missing ID
          overview: { title: 'Test Itinerary' },
          // Missing dailyItinerary
          totalBudget: { estimated: 'invalid' } // Wrong type
        }
      };

      const validation = dataRecovery.validateData(corruptedData);
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid itinerary ID');
      expect(validation.errors).toContain('Invalid daily itinerary structure');
      expect(validation.errors).toContain('Invalid budget estimation');

      // Test data repair
      const repairedData = dataRecovery.repairData(corruptedData);
      const repairedValidation = dataRecovery.validateData(repairedData);
      
      expect(repairedValidation.isValid).toBe(true);
      expect(repairedData.itinerary.id).toMatch(/recovered-\d+/);
      expect(Array.isArray(repairedData.itinerary.dailyItinerary)).toBe(true);
      expect(typeof repairedData.itinerary.totalBudget.estimated).toBe('number');

      // Test backup recovery
      const backupData = await dataRecovery.recoverFromBackup('test-itinerary-123');
      expect(backupData.itinerary.id).toBe('test-itinerary-123');
      expect(backupData.itinerary.generationMetadata.model).toBe('recovered');
    });

    it('should handle transaction rollback scenarios', async () => {
      const transactionManager = {
        transactions: new Map<string, { operations: Array<{ type: string; data: any; rollback: () => void }> }>(),

        beginTransaction: function(transactionId: string) {
          this.transactions.set(transactionId, { operations: [] });
        },

        addOperation: function(transactionId: string, operation: { type: string; data: any; rollback: () => void }) {
          const transaction = this.transactions.get(transactionId);
          if (transaction) {
            transaction.operations.push(operation);
          }
        },

        commit: async function(transactionId: string): Promise<void> {
          const transaction = this.transactions.get(transactionId);
          if (!transaction) {
            throw new Error('Transaction not found');
          }

          // Simulate commit process
          for (const operation of transaction.operations) {
            // In real implementation, this would perform the actual operations
            if (Math.random() < 0.1) { // 10% chance of failure during commit
              throw new Error(`Commit failed for operation: ${operation.type}`);
            }
          }

          this.transactions.delete(transactionId);
        },

        rollback: async function(transactionId: string): Promise<void> {
          const transaction = this.transactions.get(transactionId);
          if (!transaction) {
            return; // Already rolled back or never existed
          }

          // Rollback operations in reverse order
          const operations = [...transaction.operations].reverse();
          for (const operation of operations) {
            try {
              operation.rollback();
            } catch (error) {
              console.error(`Rollback failed for operation: ${operation.type}`, error);
            }
          }

          this.transactions.delete(transactionId);
        }
      };

      const transactionId = 'test-transaction-' + Date.now();
      
      // Begin transaction
      transactionManager.beginTransaction(transactionId);

      // Mock operations with rollback capabilities
      let userCreated = false;
      let itineraryCreated = false;
      let paymentProcessed = false;

      transactionManager.addOperation(transactionId, {
        type: 'create_user',
        data: { email: 'test@example.com' },
        rollback: () => { userCreated = false; }
      });

      transactionManager.addOperation(transactionId, {
        type: 'create_itinerary',
        data: { userId: 'user-123', destination: 'Paris' },
        rollback: () => { itineraryCreated = false; }
      });

      transactionManager.addOperation(transactionId, {
        type: 'process_payment',
        data: { amount: 2000, currency: 'USD' },
        rollback: () => { paymentProcessed = false; }
      });

      // Simulate operations
      userCreated = true;
      itineraryCreated = true;
      paymentProcessed = true;

      // Test successful commit
      try {
        await transactionManager.commit(transactionId);
        // If we reach here, transaction was successful
        expect(userCreated).toBe(true);
        expect(itineraryCreated).toBe(true);
        expect(paymentProcessed).toBe(true);
      } catch (error) {
        // If commit failed, rollback
        await transactionManager.rollback(transactionId);
        expect(userCreated).toBe(false);
        expect(itineraryCreated).toBe(false);
        expect(paymentProcessed).toBe(false);
      }
    });
  });

  describe('Real-world Error Scenarios', () => {
    it('should handle network partitioning and split-brain scenarios', async () => {
      const networkManager = {
        partitions: new Set<string>(),
        
        simulatePartition: function(nodeId: string) {
          this.partitions.add(nodeId);
        },
        
        healPartition: function(nodeId: string) {
          this.partitions.delete(nodeId);
        },
        
        isPartitioned: function(nodeId: string): boolean {
          return this.partitions.has(nodeId);
        },
        
        canCommunicate: function(node1: string, node2: string): boolean {
          return !this.isPartitioned(node1) && !this.isPartitioned(node2);
        }
      };

      const consensusManager = {
        nodes: ['node1', 'node2', 'node3'],
        leader: 'node1',
        
        electLeader: function(): string {
          const availableNodes = this.nodes.filter(node => !networkManager.isPartitioned(node));
          if (availableNodes.length === 0) {
            throw new Error('No available nodes for leader election');
          }
          
          // Simple leader election - choose first available node
          this.leader = availableNodes[0];
          return this.leader;
        },
        
        isLeader: function(nodeId: string): boolean {
          return this.leader === nodeId && !networkManager.isPartitioned(nodeId);
        },
        
        handleRequest: function(nodeId: string, request: any): any {
          if (networkManager.isPartitioned(nodeId)) {
            throw new Error('Node is partitioned');
          }
          
          if (!this.isLeader(nodeId)) {
            // Redirect to leader
            if (networkManager.isPartitioned(this.leader)) {
              // Leader is partitioned, elect new one
              this.electLeader();
            }
            return { redirect: this.leader, status: 'redirect' };
          }
          
          return { status: 'processed', data: request };
        }
      };

      // Initial state - all nodes healthy
      expect(consensusManager.leader).toBe('node1');
      expect(consensusManager.isLeader('node1')).toBe(true);

      // Simulate network partition affecting leader
      networkManager.simulatePartition('node1');
      
      // Request should trigger leader election
      try {
        consensusManager.handleRequest('node1', { type: 'test' });
      } catch (error) {
        expect(error.message).toBe('Node is partitioned');
      }

      // Try request from different node, should elect new leader
      const result = consensusManager.handleRequest('node2', { type: 'test' });
      expect(result.status).toBe('processed');
      expect(consensusManager.leader).toBe('node2'); // New leader elected

      // Heal partition
      networkManager.healPartition('node1');
      
      // Original node should no longer be leader
      expect(consensusManager.isLeader('node1')).toBe(false);
      expect(consensusManager.isLeader('node2')).toBe(true);
    });

    it('should handle memory pressure and resource exhaustion', async () => {
      const resourceManager = {
        maxMemory: 1024 * 1024 * 100, // 100MB simulation
        currentMemory: 0,
        memoryAllocations: new Map<string, number>(),
        
        allocateMemory: function(operationId: string, size: number): boolean {
          if (this.currentMemory + size > this.maxMemory) {
            return false; // Out of memory
          }
          
          this.currentMemory += size;
          this.memoryAllocations.set(operationId, size);
          return true;
        },
        
        freeMemory: function(operationId: string): void {
          const size = this.memoryAllocations.get(operationId);
          if (size) {
            this.currentMemory -= size;
            this.memoryAllocations.delete(operationId);
          }
        },
        
        getMemoryUsage: function(): { used: number; available: number; percentage: number } {
          return {
            used: this.currentMemory,
            available: this.maxMemory - this.currentMemory,
            percentage: (this.currentMemory / this.maxMemory) * 100
          };
        },
        
        isMemoryPressure: function(): boolean {
          return this.getMemoryUsage().percentage > 80;
        },
        
        performGarbageCollection: function(): number {
          // Simulate freeing up unused memory
          const freedMemory = Math.floor(this.currentMemory * 0.1); // Free 10%
          this.currentMemory -= freedMemory;
          return freedMemory;
        }
      };

      const processLargeItinerary = async (size: string): Promise<any> => {
        const operationId = `itinerary-${Date.now()}`;
        const memoryRequired = size === 'large' ? 50 * 1024 * 1024 : 10 * 1024 * 1024; // 50MB or 10MB

        try {
          // Check memory availability
          if (!resourceManager.allocateMemory(operationId, memoryRequired)) {
            // Try garbage collection
            const freed = resourceManager.performGarbageCollection();
            
            if (!resourceManager.allocateMemory(operationId, memoryRequired)) {
              throw new Error('Insufficient memory for operation');
            }
          }

          // Simulate processing
          await new Promise(resolve => setTimeout(resolve, 100));

          // Check for memory pressure during processing
          if (resourceManager.isMemoryPressure()) {
            throw new Error('Memory pressure detected during processing');
          }

          return {
            id: operationId,
            status: 'completed',
            memoryUsed: memoryRequired
          };

        } finally {
          // Always free memory
          resourceManager.freeMemory(operationId);
        }
      };

      // Test normal processing
      const result1 = await processLargeItinerary('small');
      expect(result1.status).toBe('completed');

      // Fill up memory to near capacity
      for (let i = 0; i < 8; i++) {
        resourceManager.allocateMemory(`filler-${i}`, 10 * 1024 * 1024);
      }

      const usage = resourceManager.getMemoryUsage();
      expect(usage.percentage).toBeGreaterThan(70);

      // Try large operation - should fail due to memory pressure
      await expect(processLargeItinerary('large')).rejects.toThrow('Insufficient memory for operation');

      // Free some memory
      resourceManager.freeMemory('filler-0');
      resourceManager.freeMemory('filler-1');

      // Should now succeed
      const result2 = await processLargeItinerary('small');
      expect(result2.status).toBe('completed');
    });
  });
});