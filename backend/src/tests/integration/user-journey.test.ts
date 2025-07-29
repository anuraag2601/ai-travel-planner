import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { Server } from 'http';

// Import all routes
import authRouter from '../../routes/auth.js';
import searchRouter from '../../routes/search.js';
import itinerariesRouter from '../../routes/itineraries.js';

// Mock services
const mockFirebaseService = {
  createUser: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  verifyIdToken: jest.fn(),
};

const mockAmadeusService = {
  searchFlights: jest.fn(),
  searchHotels: jest.fn(),
  searchAirports: jest.fn(),
  searchCities: jest.fn(),
  healthCheck: jest.fn()
};

const mockClaudeService = {
  generateItinerary: jest.fn(),
  refineItinerary: jest.fn(),
  generateActivitySuggestions: jest.fn(),
  healthCheck: jest.fn()
};

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn()
};

const mockAuditService = {
  logEvent: jest.fn()
};

// Mock all external dependencies
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

jest.mock('../../services/security/auditService.js', () => ({
  auditService: mockAuditService
}));

jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../../middleware/asyncHandler.js', () => ({
  asyncHandler: (fn: any) => fn
}));

jest.mock('../../middleware/rateLimiter.js', () => ({
  rateLimiter: () => (req: any, res: any, next: any) => next()
}));

jest.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    // Mock authenticated user
    req.user = {
      uid: 'test-user-123',
      email: 'test@example.com',
      displayName: 'Test User'
    };
    next();
  }
}));

describe('Complete User Journey Integration Tests', () => {
  let app: express.Application;
  let server: Server;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    // Create Express app with all routes
    app = express();
    app.use(express.json());
    
    // Add request ID middleware
    app.use((req: any, res: any, next: any) => {
      req.id = `test-request-${Date.now()}`;
      next();
    });
    
    // Mount routes
    app.use('/api/v1/auth', authRouter);
    app.use('/api/v1/search', searchRouter);
    app.use('/api/v1/itineraries', itinerariesRouter);
    
    // Start test server
    server = app.listen(0);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    userId = 'test-user-123';
    userToken = 'mock-jwt-token';
    
    // Setup audit service to always succeed
    mockAuditService.logEvent.mockResolvedValue('audit-event-123');
  });

  describe('Complete User Journey: Sign Up → Search → Generate → Refine → Export', () => {
    it('should complete full user journey successfully', async () => {
      // Step 1: User Registration
      const mockUser = {
        uid: userId,
        email: 'traveler@example.com',
        displayName: 'Jane Traveler',
        emailVerified: false
      };

      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const registrationResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'traveler@example.com',
          password: 'SecurePassword123!',
          firstName: 'Jane',
          lastName: 'Traveler'
        });

      expect(registrationResponse.status).toBe(201);
      expect(registrationResponse.body.success).toBe(true);
      expect(registrationResponse.body.data.userId).toBe(userId);

      // Step 2: User Login
      const verifiedUser = { ...mockUser, emailVerified: true };
      mockFirebaseService.getUserByEmail.mockResolvedValue(verifiedUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'traveler@example.com',
          password: 'SecurePassword123!'
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.user.userId).toBe(userId);

      // Step 3: Search for Flights
      const mockFlightResults = {
        data: [
          {
            id: 'flight-offer-1',
            oneWay: false,
            price: { currency: 'USD', total: '650.00', grandTotal: '650.00' },
            itineraries: [
              {
                duration: 'PT8H30M',
                segments: [
                  {
                    departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
                    arrival: { iataCode: 'CDG', at: '2024-12-25T23:30:00' },
                    carrierCode: 'AF',
                    number: '007'
                  }
                ]
              }
            ]
          }
        ],
        meta: { count: 1 },
        dictionaries: { carriers: { 'AF': 'Air France' } }
      };

      mockAmadeusService.searchFlights.mockResolvedValue(mockFlightResults);

      const flightSearchResponse = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          returnDate: '2024-12-30',
          adults: 2,
          children: 0,
          travelClass: 'ECONOMY'
        });

      expect(flightSearchResponse.status).toBe(200);
      expect(flightSearchResponse.body.success).toBe(true);
      expect(flightSearchResponse.body.data.flights).toHaveLength(1);

      // Step 4: Search for Hotels
      const mockHotelResults = {
        data: [
          {
            type: 'hotel-offers',
            hotel: {
              hotelId: 'HOTEL123',
              name: 'Hotel de la Paix',
              cityCode: 'PAR',
              address: {
                lines: ['19 Rue Daunou'],
                postalCode: '75002',
                cityName: 'Paris'
              }
            },
            offers: [
              {
                id: 'hotel-offer-1',
                price: { currency: 'USD', total: '180.00' },
                room: { type: 'STANDARD_ROOM' }
              }
            ]
          }
        ],
        meta: { count: 1 }
      };

      mockAmadeusService.searchHotels.mockResolvedValue(mockHotelResults);

      const hotelSearchResponse = await request(app)
        .get('/api/v1/search/hotels')
        .query({
          cityCode: 'PAR',
          checkInDate: '2024-12-25',
          checkOutDate: '2024-12-30',
          roomQuantity: 1,
          adults: 2
        });

      expect(hotelSearchResponse.status).toBe(200);
      expect(hotelSearchResponse.body.success).toBe(true);
      expect(hotelSearchResponse.body.data.hotels).toHaveLength(1);

      // Step 5: Generate Itinerary
      const mockGeneratedItinerary = {
        id: 'itinerary-123',
        userId: userId,
        overview: {
          title: '5-Day Paris Adventure',
          description: 'Romantic getaway in the City of Light',
          highlights: ['Eiffel Tower', 'Louvre Museum', 'Seine Cruise'],
          themes: ['Romance', 'Culture', 'Cuisine']
        },
        totalBudget: {
          estimated: 2800,
          currency: 'USD',
          breakdown: {
            accommodation: 900,
            activities: 800,
            food: 700,
            transportation: 400
          },
          confidence: 0.85
        },
        dailyItinerary: [
          {
            day: 1,
            date: '2024-12-25',
            theme: 'Arrival and Iconic Paris',
            location: 'Central Paris',
            activities: [
              {
                time: '14:00',
                duration: 120,
                type: 'sightseeing',
                title: 'Eiffel Tower Visit',
                description: 'Visit the iconic Eiffel Tower',
                location: { name: 'Eiffel Tower', address: 'Champ de Mars' },
                cost: { amount: 25, currency: 'USD', priceType: 'fixed' },
                bookingInfo: { required: true },
                accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
                tips: ['Book online to skip lines'],
                alternatives: ['Arc de Triomphe']
              }
            ],
            meals: [
              {
                time: '19:00',
                type: 'dinner',
                restaurant: {
                  name: 'Le Jules Verne',
                  cuisine: 'French Fine Dining',
                  location: 'Eiffel Tower',
                  priceRange: '$$$$',
                  atmosphere: 'Michelin starred elegance'
                },
                estimatedCost: { amount: 200, currency: 'USD' },
                reservationInfo: { required: true, advanceNotice: '2 months' },
                highlights: ['Tower views', 'Michelin star'],
                dietaryOptions: ['Vegetarian menu available']
              }
            ],
            transportation: [],
            dailyBudget: {
              estimated: 560,
              breakdown: {
                activities: 100,
                food: 200,
                transportation: 50,
                miscellaneous: 210
              }
            },
            tips: ['Book reservations early'],
            alternatives: []
          }
        ],
        selectedFlights: mockFlightResults.data,
        selectedHotels: mockHotelResults.data,
        preferences: {
          interests: ['culture', 'food', 'romance'],
          pace: 'moderate',
          budget: 3000
        },
        status: 'generated',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.85,
          tokensUsed: 3500,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      mockClaudeService.generateItinerary.mockResolvedValue(mockGeneratedItinerary);

      const itineraryGenerationResponse = await request(app)
        .post('/api/v1/itineraries/generate')
        .send({
          destination: 'Paris, France',
          duration: 5,
          startDate: '2024-12-25',
          endDate: '2024-12-30',
          travelers: { adults: 2, children: 0 },
          budget: {
            total: 3000,
            currency: 'USD',
            categories: {
              accommodation: 1200,
              activities: 800,
              food: 600,
              transportation: 400
            }
          },
          preferences: {
            interests: ['culture', 'food', 'romance'],
            pace: 'moderate',
            accommodationType: 'hotel',
            diningPreferences: ['fine dining', 'local cuisine'],
            activityTypes: ['cultural', 'romantic'],
            accessibility: { wheelchair: false, mobility: 'full' }
          },
          constraints: {
            avoidAreas: [],
            mustVisit: ['Eiffel Tower', 'Louvre Museum'],
            budgetConstraints: {
              maxMealCost: 100,
              maxActivityCost: 60
            }
          },
          selectedFlights: mockFlightResults.data,
          selectedHotels: mockHotelResults.data
        });

      expect(itineraryGenerationResponse.status).toBe(201);
      expect(itineraryGenerationResponse.body.success).toBe(true);
      expect(itineraryGenerationResponse.body.data.itinerary.id).toBe('itinerary-123');
      expect(itineraryGenerationResponse.body.data.itinerary.overview.title).toBe('5-Day Paris Adventure');

      const itineraryId = itineraryGenerationResponse.body.data.itinerary.id;

      // Step 6: Refine Itinerary
      const mockRefinedItinerary = {
        ...mockGeneratedItinerary,
        dailyItinerary: [
          {
            ...mockGeneratedItinerary.dailyItinerary[0],
            activities: [
              {
                ...mockGeneratedItinerary.dailyItinerary[0].activities[0],
                title: 'Louvre Museum Visit',
                description: 'Explore the world-famous Louvre Museum',
                location: { name: 'Louvre Museum', address: 'Rue de Rivoli' }
              }
            ]
          }
        ],
        status: 'refined',
        updatedAt: new Date().toISOString()
      };

      mockClaudeService.refineItinerary.mockResolvedValue(mockRefinedItinerary);

      const itineraryRefinementResponse = await request(app)
        .put(`/api/v1/itineraries/${itineraryId}/refine`)
        .send({
          refinementType: 'modify_activity',
          details: {
            day: 1,
            activityIndex: 0,
            newActivity: 'Louvre Museum visit instead of Eiffel Tower'
          },
          userFeedback: 'I prefer art museums over landmarks'
        });

      expect(itineraryRefinementResponse.status).toBe(200);
      expect(itineraryRefinementResponse.body.success).toBe(true);
      expect(itineraryRefinementResponse.body.data.itinerary.status).toBe('refined');
      expect(itineraryRefinementResponse.body.data.itinerary.dailyItinerary[0].activities[0].title)
        .toBe('Louvre Museum Visit');

      // Step 7: Save/Finalize Itinerary
      const itinerarySaveResponse = await request(app)
        .put(`/api/v1/itineraries/${itineraryId}`)
        .send({
          status: 'saved',
          customNotes: 'Excited for this trip!',
          sharedWith: []
        });

      expect(itinerarySaveResponse.status).toBe(200);
      expect(itinerarySaveResponse.body.success).toBe(true);
      expect(itinerarySaveResponse.body.data.itinerary.status).toBe('saved');

      // Step 8: Get User's Itineraries
      const mockUserItineraries = [mockRefinedItinerary];
      
      const userItinerariesResponse = await request(app)
        .get('/api/v1/itineraries')
        .query({ status: 'saved', limit: 10, offset: 0 });

      expect(userItinerariesResponse.status).toBe(200);
      expect(userItinerariesResponse.body.success).toBe(true);
      expect(userItinerariesResponse.body.data.itineraries).toBeDefined();

      // Step 9: Export Itinerary
      const itineraryExportResponse = await request(app)
        .post(`/api/v1/itineraries/${itineraryId}/export`)
        .send({
          format: 'pdf',
          includeFlights: true,
          includeHotels: true,
          includeActivities: true,
          customization: {
            coverImage: true,
            personalNotes: true,
            emergencyContacts: true
          }
        });

      expect(itineraryExportResponse.status).toBe(200);
      expect(itineraryExportResponse.body.success).toBe(true);
      expect(itineraryExportResponse.body.data.downloadUrl).toBeDefined();

      // Verify audit events were logged for key actions
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'register',
          outcome: 'success',
          userId: userId
        })
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'login',
          outcome: 'success',
          userId: userId
        })
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'generate_itinerary',
          outcome: 'success',
          userId: userId
        })
      );
    });

    it('should handle partial journey with failures gracefully', async () => {
      // Step 1: Successful Registration
      const mockUser = {
        uid: 'partial-user-123',
        email: 'partial@example.com',
        displayName: 'Partial User',
        emailVerified: false
      };

      mockFirebaseService.createUser.mockResolvedValue(mockUser);

      const registrationResponse = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'partial@example.com',
          password: 'SecurePassword123!',
          firstName: 'Partial',
          lastName: 'User'
        });

      expect(registrationResponse.status).toBe(201);

      // Step 2: Failed Login (invalid credentials)
      mockFirebaseService.getUserByEmail.mockResolvedValue(null);

      const failedLoginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'partial@example.com',
          password: 'WrongPassword123!'
        });

      expect(failedLoginResponse.status).toBe(401);
      expect(failedLoginResponse.body.success).toBe(false);

      // Step 3: Successful Login after correction
      const verifiedUser = { ...mockUser, emailVerified: true };
      mockFirebaseService.getUserByEmail.mockResolvedValue(verifiedUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'partial@example.com',
          password: 'SecurePassword123!'
        });

      expect(loginResponse.status).toBe(200);

      // Step 4: Failed Flight Search (external API error)
      mockAmadeusService.searchFlights.mockRejectedValue(new Error('Rate limit exceeded'));

      const failedFlightSearchResponse = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });

      expect(failedFlightSearchResponse.status).toBe(500);
      expect(failedFlightSearchResponse.body.success).toBe(false);

      // Step 5: Successful Hotel Search (fallback)
      const mockHotelResults = {
        data: [{ hotel: { name: 'Test Hotel' }, offers: [{ price: { total: '100' } }] }],
        meta: { count: 1 }
      };

      mockAmadeusService.searchHotels.mockResolvedValue(mockHotelResults);

      const hotelSearchResponse = await request(app)
        .get('/api/v1/search/hotels')
        .query({
          cityCode: 'PAR',
          checkInDate: '2024-12-25',
          checkOutDate: '2024-12-30',
          adults: 2
        });

      expect(hotelSearchResponse.status).toBe(200);

      // Step 6: Failed Itinerary Generation (AI service unavailable)
      mockClaudeService.generateItinerary.mockRejectedValue(new Error('AI service temporarily unavailable'));

      const failedItineraryResponse = await request(app)
        .post('/api/v1/itineraries/generate')
        .send({
          destination: 'Paris, France',
          duration: 3,
          travelers: { adults: 2, children: 0 },
          budget: { total: 2000, currency: 'USD' }
        });

      expect(failedItineraryResponse.status).toBe(500);
      expect(failedItineraryResponse.body.success).toBe(false);

      // Verify that failed attempts are also audited
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'login',
          outcome: 'failure'
        })
      );

      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'search_flights',
          outcome: 'failure'
        })
      );
    });
  });

  describe('Multi-user Concurrent Journey Testing', () => {
    it('should handle multiple users searching simultaneously', async () => {
      const users = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
        { id: 'user-3', email: 'user3@example.com' }
      ];

      // Mock successful responses for all users
      mockAmadeusService.searchFlights.mockResolvedValue({
        data: [{ id: 'flight-1', price: { total: '500' } }],
        meta: { count: 1 }
      });

      mockAmadeusService.searchHotels.mockResolvedValue({
        data: [{ hotel: { name: 'Hotel 1' }, offers: [{ price: { total: '150' } }] }],
        meta: { count: 1 }
      });

      // Simulate concurrent searches
      const searchPromises = users.map(async (user, index) => {
        const flightSearch = request(app)
          .get('/api/v1/search/flights')
          .query({
            origin: 'JFK',
            destination: 'LAX',
            departureDate: '2024-12-25',
            adults: 1 + index // Different passenger counts
          });

        const hotelSearch = request(app)
          .get('/api/v1/search/hotels')
          .query({
            cityCode: 'LAX',
            checkInDate: '2024-12-25',
            checkOutDate: '2024-12-27',
            adults: 1 + index
          });

        return Promise.all([flightSearch, hotelSearch]);
      });

      const results = await Promise.all(searchPromises);

      // Verify all searches succeeded
      results.forEach(([flightResult, hotelResult]) => {
        expect(flightResult.status).toBe(200);
        expect(hotelResult.status).toBe(200);
      });

      // Verify services were called correct number of times
      expect(mockAmadeusService.searchFlights).toHaveBeenCalledTimes(3);
      expect(mockAmadeusService.searchHotels).toHaveBeenCalledTimes(3);
    });
  });

  describe('User Journey Error Recovery Scenarios', () => {
    it('should recover from temporary service outages', async () => {
      // Simulate service outage followed by recovery
      mockAmadeusService.searchFlights
        .mockRejectedValueOnce(new Error('Service temporarily unavailable'))
        .mockResolvedValueOnce({
          data: [{ id: 'flight-recovery', price: { total: '600' } }],
          meta: { count: 1 }
        });

      // First attempt fails
      const failedAttempt = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });

      expect(failedAttempt.status).toBe(500);

      // Second attempt succeeds
      const successfulAttempt = await request(app)
        .get('/api/v1/search/flights')
        .query({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2
        });

      expect(successfulAttempt.status).toBe(200);
      expect(successfulAttempt.body.data.flights[0].id).toBe('flight-recovery');
    });

    it('should handle itinerary generation with fallback responses', async () => {
      // Mock initial failure followed by fallback success
      mockClaudeService.generateItinerary
        .mockRejectedValueOnce(new Error('AI model timeout'))
        .mockResolvedValueOnce({
          id: 'fallback-itinerary',
          overview: {
            title: 'Basic Paris Itinerary',
            description: 'Simplified itinerary due to service limitations',
            highlights: ['Essential Paris sights'],
            themes: ['Basic sightseeing']
          },
          generationMetadata: {
            model: 'fallback',
            confidence: 0.6,
            tokensUsed: 0,
            generatedAt: new Date().toISOString(),
            version: '1.0'
          }
        });

      // First attempt fails
      const failedGeneration = await request(app)
        .post('/api/v1/itineraries/generate')
        .send({
          destination: 'Paris, France',
          duration: 3,
          travelers: { adults: 2, children: 0 },
          budget: { total: 2000, currency: 'USD' }
        });

      expect(failedGeneration.status).toBe(500);

      // Retry with fallback succeeds
      const fallbackGeneration = await request(app)
        .post('/api/v1/itineraries/generate')
        .send({
          destination: 'Paris, France',
          duration: 3,
          travelers: { adults: 2, children: 0 },
          budget: { total: 2000, currency: 'USD' }
        });

      expect(fallbackGeneration.status).toBe(201);
      expect(fallbackGeneration.body.data.itinerary.id).toBe('fallback-itinerary');
      expect(fallbackGeneration.body.data.itinerary.generationMetadata.model).toBe('fallback');
    });
  });

  describe('Data Consistency and Validation', () => {
    it('should maintain data consistency across user journey', async () => {
      const testUser = {
        uid: 'consistency-user',
        email: 'consistency@example.com',
        displayName: 'Consistency User'
      };

      // User registration
      mockFirebaseService.createUser.mockResolvedValue(testUser);
      
      const registrationData = {
        email: 'consistency@example.com',
        password: 'SecurePassword123!',
        firstName: 'Consistency',
        lastName: 'User'
      };

      const registrationResponse = await request(app)
        .post('/api/v1/auth/register')
        .send(registrationData);

      expect(registrationResponse.status).toBe(201);

      // Verify consistent data format
      expect(registrationResponse.body).toMatchObject({
        success: true,
        data: {
          userId: testUser.uid,
          email: registrationData.email
        },
        message: expect.any(String),
        timestamp: expect.any(String),
        requestId: expect.any(String)
      });

      // Search operations with data validation
      const flightSearchData = {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2024-12-25',
        returnDate: '2024-12-30',
        adults: 2,
        children: 1,
        travelClass: 'ECONOMY'
      };

      mockAmadeusService.searchFlights.mockResolvedValue({
        data: [{
          id: 'test-flight',
          price: { currency: 'USD', total: '750.00' },
          itineraries: [{ duration: 'PT5H30M', segments: [] }]
        }],
        meta: { count: 1 }
      });

      const flightSearchResponse = await request(app)
        .get('/api/v1/search/flights')
        .query(flightSearchData);

      // Verify consistent response structure
      expect(flightSearchResponse.body).toMatchObject({
        success: true,
        data: {
          flights: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              price: expect.objectContaining({
                currency: expect.any(String),
                total: expect.any(String)
              })
            })
          ]),
          searchParams: expect.objectContaining({
            origin: flightSearchData.origin,
            destination: flightSearchData.destination
          })
        },
        message: expect.any(String),
        timestamp: expect.any(String),
        requestId: expect.any(String)
      });

      // Verify audit events maintain consistent structure
      expect(mockAuditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(String),
          action: expect.any(String),
          resource: expect.any(String),
          outcome: expect.stringMatching(/^(success|failure|denied)$/),
          severity: expect.stringMatching(/^(low|medium|high|critical)$/),
          source: expect.objectContaining({
            ip: expect.any(String),
            method: expect.any(String),
            path: expect.any(String)
          })
        })
      );
    });
  });
});