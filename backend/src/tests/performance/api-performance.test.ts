import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { performance } from 'perf_hooks';

// Import routes for testing
import authRouter from '../../routes/auth.js';
import searchRouter from '../../routes/search.js';
import itinerariesRouter from '../../routes/itineraries.js';

// Mock services with performance considerations
const mockFirebaseService = {
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  verifyIdToken: jest.fn(),
};

const mockAmadeusService = {
  searchFlights: jest.fn(),
  searchHotels: jest.fn(),
  healthCheck: jest.fn()
};

const mockClaudeService = {
  generateItinerary: jest.fn(),
  healthCheck: jest.fn()
};

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn()
};

// Mock all dependencies
jest.mock('../../services/external/firebaseService.js', () => ({
  FirebaseService: jest.fn(() => mockFirebaseService)
}));

jest.mock('../../services/external/amadeusService.js', () => ({
  AmadeusService: jest.fn(() => mockAmadeusService)
}));

jest.mock('../../services/external/claudeService.js', () => ({
  ClaudeService: jest.fn(() => mockClaudeService)
}));

jest.mock('../../services/redis.js', () => ({
  RedisService: jest.fn(() => mockRedisService)
}));

jest.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { uid: 'test-user', email: 'test@example.com' };
    next();
  }
}));

describe('API Performance Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '10mb' }));
    
    // Add request timing middleware
    app.use((req: any, res: any, next: any) => {
      req.startTime = performance.now();
      next();
    });
    
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/search', searchRouter);
    app.use('/api/v1/itineraries', itinerariesRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication Performance', () => {
    it('should handle user registration within acceptable time limits', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User'
      };

      // Mock fast Firebase response
      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const startTime = performance.now();
      
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          firstName: 'Test',
          lastName: 'User'
        });

      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(201);
      expect(responseTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle multiple concurrent registration requests', async () => {
      const mockUser = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User'
      };

      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const concurrentRequests = 10;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => 
        request(app)
          .post('/api/v1/auth/register')
          .send({
            email: `test${i}@example.com`,
            password: 'Password123!',
            firstName: 'Test',
            lastName: 'User'
          })
      );

      const startTime = performance.now();
      const responses = await Promise.all(requests);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      // Average response time should be reasonable
      const averageTime = totalTime / concurrentRequests;
      expect(averageTime).toBeLessThan(2000); // Average < 2 seconds per request
    });

    it('should handle token verification efficiently', async () => {
      const mockDecodedToken = {
        uid: 'user123',
        email: 'test@example.com',
        email_verified: true
      };

      // Mock Redis cache hit for better performance
      mockRedisService.get.mockResolvedValue(JSON.stringify(mockDecodedToken));
      mockFirebaseService.verifyIdToken.mockResolvedValue(mockDecodedToken);

      const iterations = 100;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        
        const response = await request(app)
          .post('/api/v1/auth/verify')
          .send({
            idToken: 'mock-id-token'
          });

        const endTime = performance.now();
        times.push(endTime - startTime);

        expect(response.status).toBe(200);
      }

      const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
      const maxTime = Math.max(...times);
      const minTime = Math.min(...times);

      console.log(`Token verification performance:
        Average: ${averageTime.toFixed(2)}ms
        Min: ${minTime.toFixed(2)}ms
        Max: ${maxTime.toFixed(2)}ms`);

      expect(averageTime).toBeLessThan(100); // Should average < 100ms
      expect(maxTime).toBeLessThan(500); // No single request > 500ms
    });
  });

  describe('Search Performance', () => {
    it('should handle flight search with caching optimization', async () => {
      const mockFlightResults = {
        data: Array.from({ length: 50 }, (_, i) => ({
          id: `flight-${i}`,
          price: { total: '500.00', currency: 'USD' },
          itineraries: [{
            duration: 'PT5H30M',
            segments: [{
              departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
              arrival: { iataCode: 'CDG', at: '2024-12-25T15:30:00' }
            }]
          }]
        })),
        meta: { count: 50 }
      };

      // Test cache miss (first request)
      mockRedisService.get.mockResolvedValueOnce(null);
      mockAmadeusService.searchFlights.mockResolvedValue(mockFlightResults);

      const startTimeFirst = performance.now();
      const firstResponse = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });
      const endTimeFirst = performance.now();
      const firstRequestTime = endTimeFirst - startTimeFirst;

      expect(firstResponse.status).toBe(200);

      // Test cache hit (subsequent request)
      mockRedisService.get.mockResolvedValueOnce(JSON.stringify(mockFlightResults));

      const startTimeSecond = performance.now();
      const secondResponse = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });
      const endTimeSecond = performance.now();
      const secondRequestTime = endTimeSecond - startTimeSecond;

      expect(secondResponse.status).toBe(200);

      // Cached request should be significantly faster
      console.log(`Flight search performance:
        First request (cache miss): ${firstRequestTime.toFixed(2)}ms
        Second request (cache hit): ${secondRequestTime.toFixed(2)}ms
        Performance improvement: ${((firstRequestTime - secondRequestTime) / firstRequestTime * 100).toFixed(1)}%`);

      expect(secondRequestTime).toBeLessThan(firstRequestTime * 0.5); // Cache should be 50%+ faster
      expect(secondRequestTime).toBeLessThan(200); // Cached response < 200ms
    });

    it('should handle large result sets efficiently', async () => {
      // Mock large dataset (500 flights)
      const largeFlightResults = {
        data: Array.from({ length: 500 }, (_, i) => ({
          id: `flight-${i}`,
          price: { total: `${500 + i * 10}.00`, currency: 'USD' },
          itineraries: [{
            duration: 'PT5H30M',
            segments: [{
              departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
              arrival: { iataCode: 'CDG', at: '2024-12-25T15:30:00' }
            }]
          }]
        })),
        meta: { count: 500 }
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusService.searchFlights.mockResolvedValue(largeFlightResults);

      const startTime = performance.now();
      const response = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(200);
      expect(response.body.data.flights).toHaveLength(500);
      expect(responseTime).toBeLessThan(3000); // Should handle large dataset < 3 seconds

      // Check response size
      const responseSize = JSON.stringify(response.body).length;
      console.log(`Large dataset performance:
        Response time: ${responseTime.toFixed(2)}ms
        Response size: ${(responseSize / 1024).toFixed(2)}KB
        Records: 500 flights`);
    });

    it('should maintain performance under concurrent search requests', async () => {
      const mockResults = {
        data: Array.from({ length: 20 }, (_, i) => ({
          id: `flight-${i}`,
          price: { total: '500.00', currency: 'USD' }
        })),
        meta: { count: 20 }
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusService.searchFlights.mockResolvedValue(mockResults);

      const concurrentSearches = 20;
      const searchPromises = Array.from({ length: concurrentSearches }, (_, i) =>
        request(app)
          .get('/api/v1/search/flights')
          .query({
            origin: 'JFK',
            destination: 'CDG',
            departureDate: '2024-12-25',
            adults: 2,
            requestId: `req-${i}` // Unique identifier
          })
      );

      const startTime = performance.now();
      const responses = await Promise.all(searchPromises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      const averageTime = totalTime / concurrentSearches;
      console.log(`Concurrent search performance:
        Total time: ${totalTime.toFixed(2)}ms
        Average per request: ${averageTime.toFixed(2)}ms
        Concurrent requests: ${concurrentSearches}`);

      expect(averageTime).toBeLessThan(1500); // Average response time < 1.5 seconds
    });
  });

  describe('Itinerary Generation Performance', () => {
    it('should handle itinerary generation within acceptable time limits', async () => {
      const mockItinerary = {
        id: 'itinerary-123',
        overview: {
          title: '5-Day Paris Adventure',
          description: 'Cultural exploration of Paris'
        },
        dailyItinerary: Array.from({ length: 5 }, (_, day) => ({
          day: day + 1,
          date: `2024-12-${25 + day}`,
          theme: `Day ${day + 1} Theme`,
          activities: Array.from({ length: 3 }, (_, i) => ({
            time: `${10 + i * 3}:00`,
            title: `Activity ${i + 1}`,
            description: 'Description of activity',
            duration: 120,
            cost: { amount: 25, currency: 'USD' }
          })),
          meals: Array.from({ length: 3 }, (_, i) => ({
            time: `${8 + i * 5}:00`,
            type: ['breakfast', 'lunch', 'dinner'][i],
            restaurant: { name: `Restaurant ${i + 1}`, cuisine: 'French' },
            estimatedCost: { amount: 30, currency: 'USD' }
          }))
        })),
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.85,
          tokensUsed: 3500,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      mockClaudeService.generateItinerary.mockResolvedValue(mockItinerary);

      const startTime = performance.now();
      const response = await request(app)
        .post('/api/v1/itineraries/generate')
        .send({
          destination: 'Paris, France',
          duration: 5,
          startDate: '2024-12-25',
          endDate: '2024-12-30',
          travelers: { adults: 2, children: 0 },
          budget: { total: 3000, currency: 'USD' },
          preferences: {
            interests: ['culture', 'food'],
            pace: 'moderate'
          }
        });
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(201);
      expect(response.body.data.itinerary.id).toBe('itinerary-123');
      expect(responseTime).toBeLessThan(10000); // Should complete within 10 seconds

      console.log(`Itinerary generation performance:
        Response time: ${responseTime.toFixed(2)}ms
        Activities generated: ${5 * 3}
        Meals generated: ${5 * 3}`);
    });

    it('should handle complex itinerary generation efficiently', async () => {
      const complexItinerary = {
        id: 'complex-itinerary-123',
        overview: {
          title: '14-Day Grand European Tour',
          description: 'Comprehensive tour across multiple European cities'
        },
        dailyItinerary: Array.from({ length: 14 }, (_, day) => ({
          day: day + 1,
          date: `2024-06-${1 + day}`,
          theme: `Day ${day + 1} Theme`,
          activities: Array.from({ length: 5 }, (_, i) => ({
            time: `${9 + i * 2}:00`,
            title: `Activity ${i + 1}`,
            description: 'Detailed activity description',
            duration: 90,
            cost: { amount: 35, currency: 'EUR' }
          })),
          meals: Array.from({ length: 3 }, (_, i) => ({
            time: `${8 + i * 5}:00`,
            type: ['breakfast', 'lunch', 'dinner'][i],
            restaurant: { name: `Restaurant ${i + 1}`, cuisine: 'Local' },
            estimatedCost: { amount: 45, currency: 'EUR' }
          }))
        })),
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.88,
          tokensUsed: 8500,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      mockClaudeService.generateItinerary.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve(complexItinerary), 5000) // Simulate 5 second generation
        )
      );

      const startTime = performance.now();
      const response = await request(app)
        .post('/api/v1/itineraries/generate')
        .send({
          destination: 'Multi-city European Tour',
          duration: 14,
          startDate: '2024-06-01',
          endDate: '2024-06-14',
          travelers: { adults: 2, children: 1 },
          budget: { total: 8000, currency: 'EUR' },
          preferences: {
            interests: ['culture', 'history', 'food', 'museums'],
            pace: 'moderate'
          }
        });
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      expect(response.status).toBe(201);
      expect(response.body.data.itinerary.dailyItinerary).toHaveLength(14);
      expect(responseTime).toBeLessThan(15000); // Complex itinerary within 15 seconds

      console.log(`Complex itinerary performance:
        Response time: ${responseTime.toFixed(2)}ms
        Days: 14
        Total activities: ${14 * 5}
        Total meals: ${14 * 3}`);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should handle memory-intensive operations without leaks', async () => {
      const initialMemory = process.memoryUsage();

      // Perform multiple memory-intensive operations
      const iterations = 50;
      const promises = [];

      for (let i = 0; i < iterations; i++) {
        const mockLargeItinerary = {
          id: `large-itinerary-${i}`,
          overview: { title: `Large Itinerary ${i}` },
          dailyItinerary: Array.from({ length: 30 }, (_, day) => ({
            day: day + 1,
            activities: Array.from({ length: 10 }, (_, j) => ({
              title: `Activity ${j} with very long description that contains a lot of details about the activity including historical context, practical information, tips for visitors, and alternative options`.repeat(5),
              description: 'Very detailed description'.repeat(100)
            }))
          })),
          generationMetadata: {
            tokensUsed: 10000,
            generatedAt: new Date().toISOString()
          }
        };

        mockClaudeService.generateItinerary.mockResolvedValueOnce(mockLargeItinerary);

        promises.push(
          request(app)
            .post('/api/v1/itineraries/generate')
            .send({
              destination: `Destination ${i}`,
              duration: 30,
              travelers: { adults: 2, children: 0 },
              budget: { total: 10000, currency: 'USD' }
            })
        );
      }

      await Promise.all(promises);

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePerOp = memoryIncrease / iterations;

      console.log(`Memory usage analysis:
        Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
        Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
        Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB
        Per operation: ${(memoryIncreasePerOp / 1024).toFixed(2)}KB`);

      // Memory increase should be reasonable
      expect(memoryIncreasePerOp).toBeLessThan(1024 * 1024); // Less than 1MB per operation
    });

    it('should handle CPU-intensive operations efficiently', async () => {
      // Mock CPU-intensive operation (complex itinerary with many calculations)
      mockClaudeService.generateItinerary.mockImplementation(async () => {
        // Simulate CPU-intensive work
        const start = Date.now();
        let result = 0;
        while (Date.now() - start < 100) { // 100ms of CPU work
          result += Math.random();
        }

        return {
          id: 'cpu-intensive-itinerary',
          overview: { title: 'CPU Intensive Itinerary' },
          dailyItinerary: [],
          generationMetadata: {
            tokensUsed: 5000,
            generatedAt: new Date().toISOString()
          }
        };
      });

      const concurrentCPUOperations = 10;
      const promises = Array.from({ length: concurrentCPUOperations }, () =>
        request(app)
          .post('/api/v1/itineraries/generate')
          .send({
            destination: 'CPU Test Destination',
            duration: 5,
            travelers: { adults: 2, children: 0 },
            budget: { total: 3000, currency: 'USD' }
          })
      );

      const startTime = performance.now();
      const responses = await Promise.all(promises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      responses.forEach(response => {
        expect(response.status).toBe(201);
      });

      const averageTime = totalTime / concurrentCPUOperations;
      console.log(`CPU-intensive operations performance:
        Total time: ${totalTime.toFixed(2)}ms
        Average time: ${averageTime.toFixed(2)}ms
        Concurrent operations: ${concurrentCPUOperations}`);

      // Should handle concurrent CPU operations efficiently
      expect(totalTime).toBeLessThan(2000); // Total time < 2 seconds
      expect(averageTime).toBeLessThan(500); // Average < 500ms per operation
    });
  });

  describe('Database Performance Simulation', () => {
    it('should handle database query simulation efficiently', async () => {
      // Simulate database operations with varying latencies
      const simulateDbQuery = (latency: number) => 
        new Promise(resolve => setTimeout(resolve, latency));

      const dbOperations = [
        () => simulateDbQuery(50),  // Fast query
        () => simulateDbQuery(200), // Medium query
        () => simulateDbQuery(100), // Another medium query
        () => simulateDbQuery(300), // Slow query
      ];

      // Test sequential vs parallel execution
      const startSequential = performance.now();
      for (const operation of dbOperations) {
        await operation();
      }
      const endSequential = performance.now();
      const sequentialTime = endSequential - startSequential;

      const startParallel = performance.now();
      await Promise.all(dbOperations.map(op => op()));
      const endParallel = performance.now();
      const parallelTime = endParallel - startParallel;

      console.log(`Database operation performance:
        Sequential: ${sequentialTime.toFixed(2)}ms
        Parallel: ${parallelTime.toFixed(2)}ms
        Improvement: ${((sequentialTime - parallelTime) / sequentialTime * 100).toFixed(1)}%`);

      expect(parallelTime).toBeLessThan(sequentialTime * 0.6); // Parallel should be 40%+ faster
      expect(parallelTime).toBeLessThan(400); // Should complete within 400ms
    });
  });

  describe('Response Compression and Optimization', () => {
    it('should handle large responses efficiently', async () => {
      const largeResponse = {
        success: true,
        data: {
          flights: Array.from({ length: 1000 }, (_, i) => ({
            id: `flight-${i}`,
            airline: `Airline ${i % 10}`,
            price: { total: `${500 + i}.00`, currency: 'USD' },
            description: 'Very detailed flight description with lots of information about amenities, baggage policies, seat configurations, and other details that passengers need to know.'.repeat(3),
            itineraries: [{
              duration: 'PT8H30M',
              segments: Array.from({ length: 2 }, (_, j) => ({
                departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
                arrival: { iataCode: 'CDG', at: '2024-12-25T18:30:00' },
                details: 'Detailed segment information'.repeat(10)
              }))
            }]
          }))
        }
      };

      mockAmadeusService.searchFlights.mockResolvedValue(largeResponse);

      const startTime = performance.now();
      const response = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      const responseSize = JSON.stringify(response.body).length;

      console.log(`Large response performance:
        Response time: ${responseTime.toFixed(2)}ms
        Response size: ${(responseSize / 1024 / 1024).toFixed(2)}MB
        Records: 1000 flights`);

      expect(response.status).toBe(200);
      expect(responseTime).toBeLessThan(5000); // Should handle large response < 5 seconds
      expect(responseSize).toBeGreaterThan(1024 * 1024); // Should be > 1MB to test large responses
    });
  });
});