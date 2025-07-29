import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import nock from 'nock';
import { performance } from 'perf_hooks';

// Import services for testing
import { AmadeusService } from '../../services/external/amadeusService.js';
import { ClaudeService } from '../../services/external/claudeService.js';
import { FirebaseService } from '../../services/external/firebaseService.js';

// Mock Redis for caching tests
const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn()
};

// Mock configurations
const mockConfig = {
  amadeus: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    baseUrl: 'https://test.api.amadeus.com'
  },
  anthropic: {
    apiKey: 'test-anthropic-key',
    baseUrl: 'https://api.anthropic.com'
  },
  firebase: {
    projectId: 'test-project',
    clientEmail: 'test@test-project.iam.gserviceaccount.com',
    privateKey: 'test-private-key'
  }
};

describe('External API Integration Tests', () => {
  let amadeusService: AmadeusService;
  let claudeService: ClaudeService;
  let firebaseService: FirebaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Initialize services with mocked dependencies
    amadeusService = new AmadeusService();
    claudeService = new ClaudeService();
    firebaseService = new FirebaseService();

    // Mock Redis service for all services
    (amadeusService as any).redis = mockRedisService;
    (claudeService as any).redis = mockRedisService;
    (firebaseService as any).redis = mockRedisService;

    // Clear nock
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
    jest.restoreAllMocks();
  });

  describe('Amadeus API Integration', () => {
    describe('Authentication and Token Management', () => {
      it('should authenticate and obtain access token', async () => {
        const tokenResponse = {
          access_token: 'test-access-token-123',
          token_type: 'Bearer',
          expires_in: 1799,
          scope: 'read'
        };

        // Mock OAuth token endpoint
        const tokenScope = nock('https://test.api.amadeus.com')
          .post('/v1/security/oauth2/token')
          .reply(200, tokenResponse);

        // Mock flight search endpoint
        const searchScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .matchHeader('Authorization', 'Bearer test-access-token-123')
          .reply(200, {
            data: [{
              id: 'flight-1',
              price: { currency: 'USD', total: '500.00' },
              itineraries: [{
                duration: 'PT8H30M',
                segments: [{
                  departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
                  arrival: { iataCode: 'CDG', at: '2024-12-25T23:30:00' }
                }]
              }]
            }],
            meta: { count: 1 }
          });

        const result = await amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2,
          children: 0,
          travelClass: 'ECONOMY'
        });

        expect(tokenScope.isDone()).toBe(true);
        expect(searchScope.isDone()).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0].id).toBe('flight-1');
      });

      it('should handle token refresh on expiration', async () => {
        // Mock initial token request
        const initialTokenScope = nock('https://test.api.amadeus.com')
          .post('/v1/security/oauth2/token')
          .reply(200, {
            access_token: 'expired-token',
            token_type: 'Bearer',
            expires_in: 1,
            scope: 'read'
          });

        // Mock API call with expired token
        const expiredCallScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .matchHeader('Authorization', 'Bearer expired-token')
          .reply(401, {
            error: {
              status: 401,
              code: 38192,
              title: 'Invalid access token'
            }
          });

        // Mock token refresh
        const refreshTokenScope = nock('https://test.api.amadeus.com')
          .post('/v1/security/oauth2/token')
          .reply(200, {
            access_token: 'new-access-token',
            token_type: 'Bearer',
            expires_in: 1799,
            scope: 'read'
          });

        // Mock successful retry with new token
        const retryCallScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .matchHeader('Authorization', 'Bearer new-access-token')
          .reply(200, {
            data: [{
              id: 'flight-retry',
              price: { currency: 'USD', total: '600.00' }
            }],
            meta: { count: 1 }
          });

        const result = await amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 1,
          children: 0,
          travelClass: 'ECONOMY'
        });

        expect(initialTokenScope.isDone()).toBe(true);
        expect(expiredCallScope.isDone()).toBe(true);
        expect(refreshTokenScope.isDone()).toBe(true);
        expect(retryCallScope.isDone()).toBe(true);
        expect(result.data[0].id).toBe('flight-retry');
      });

      it('should handle rate limiting with retry after delay', async () => {
        // Mock token endpoint
        nock('https://test.api.amadeus.com')
          .post('/v1/security/oauth2/token')
          .reply(200, {
            access_token: 'test-token',
            token_type: 'Bearer',
            expires_in: 1799
          });

        // Mock rate limited response
        const rateLimitScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(429, {
            error: {
              status: 429,
              code: 4926,
              title: 'Rate limit exceeded'
            }
          }, {
            'Retry-After': '2'
          });

        // Mock successful retry after delay
        const retryScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(200, {
            data: [{
              id: 'flight-after-retry',
              price: { currency: 'USD', total: '700.00' }
            }],
            meta: { count: 1 }
          });

        const startTime = performance.now();
        
        const result = await amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 1,
          children: 0,
          travelClass: 'ECONOMY'
        });

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(rateLimitScope.isDone()).toBe(true);
        expect(retryScope.isDone()).toBe(true);
        expect(result.data[0].id).toBe('flight-after-retry');
        expect(duration).toBeGreaterThan(2000); // Should have waited for retry
      });
    });

    describe('Flight Search Scenarios', () => {
      beforeEach(() => {
        // Mock authentication for all flight search tests
        nock('https://test.api.amadeus.com')
          .persist()
          .post('/v1/security/oauth2/token')
          .reply(200, {
            access_token: 'test-token',
            token_type: 'Bearer',
            expires_in: 1799
          });
      });

      it('should handle complex multi-city flight search', async () => {
        const multiCityResponse = {
          data: [
            {
              id: 'multi-city-1',
              oneWay: false,
              price: { currency: 'USD', total: '1250.00', grandTotal: '1250.00' },
              itineraries: [
                {
                  duration: 'PT15H30M',
                  segments: [
                    {
                      departure: { iataCode: 'JFK', at: '2024-12-25T10:00:00' },
                      arrival: { iataCode: 'LHR', at: '2024-12-25T22:00:00' },
                      carrierCode: 'BA',
                      number: '177'
                    },
                    {
                      departure: { iataCode: 'LHR', at: '2024-12-26T08:00:00' },
                      arrival: { iataCode: 'CDG', at: '2024-12-26T10:30:00' },
                      carrierCode: 'AF',
                      number: '1234'
                    }
                  ]
                }
              ]
            }
          ],
          meta: { count: 1 },
          dictionaries: {
            carriers: { 'BA': 'British Airways', 'AF': 'Air France' },
            aircraft: { '320': 'Airbus A320' },
            locations: {
              'JFK': { cityCode: 'NYC', countryCode: 'US' },
              'LHR': { cityCode: 'LON', countryCode: 'GB' },
              'CDG': { cityCode: 'PAR', countryCode: 'FR' }
            }
          }
        };

        const searchScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(query => {
            return query.originLocationCode === 'JFK' &&
                   query.destinationLocationCode === 'CDG' &&
                   query.departureDate === '2024-12-25' &&
                   query.adults === '2';
          })
          .reply(200, multiCityResponse);

        const result = await amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 2,
          children: 0,
          travelClass: 'ECONOMY'
        });

        expect(searchScope.isDone()).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0].itineraries[0].segments).toHaveLength(2);
        expect(result.dictionaries.carriers['BA']).toBe('British Airways');
      });

      it('should handle hotel search with location and amenity filters', async () => {
        const hotelResponse = {
          data: [
            {
              type: 'hotel-offers',
              hotel: {
                hotelId: 'HOTEL123',
                chainCode: 'HI',
                dupeId: 'duplicate-123',
                name: 'Hotel de la Paix',
                cityCode: 'PAR',
                latitude: 48.8566,
                longitude: 2.3522,
                address: {
                  lines: ['19 Rue Daunou'],
                  postalCode: '75002',
                  cityName: 'Paris',
                  countryCode: 'FR'
                },
                amenities: ['WIFI', 'PARKING', 'POOL', 'FITNESS_CENTER'],
                rating: '4'
              },
              offers: [
                {
                  id: 'hotel-offer-1',
                  checkInDate: '2024-12-25',
                  checkOutDate: '2024-12-30',
                  price: {
                    currency: 'USD',
                    total: '180.00',
                    base: '150.00',
                    taxes: '30.00'
                  },
                  room: {
                    type: 'DELUXE_ROOM',
                    typeEstimated: {
                      category: 'DELUXE_ROOM',
                      beds: 1,
                      bedType: 'KING'
                    }
                  },
                  policies: {
                    cancellation: {
                      deadline: '2024-12-24T18:00:00',
                      amount: '0.00'
                    }
                  },
                  rateFamilyEstimated: {
                    code: 'PRO',
                    type: 'P'
                  }
                }
              ]
            }
          ],
          meta: { count: 1 }
        };

        const hotelScope = nock('https://test.api.amadeus.com')
          .get('/v3/shopping/hotel-offers')
          .query(query => {
            return query.cityCode === 'PAR' &&
                   query.checkInDate === '2024-12-25' &&
                   query.checkOutDate === '2024-12-30';
          })
          .reply(200, hotelResponse);

        const result = await amadeusService.searchHotels({
          cityCode: 'PAR',
          checkInDate: '2024-12-25',
          checkOutDate: '2024-12-30',
          roomQuantity: 1,
          adults: 2,
          children: 0,
          priceRange: '100-300',
          amenities: ['WIFI', 'POOL']
        });

        expect(hotelScope.isDone()).toBe(true);
        expect(result.data).toHaveLength(1);
        expect(result.data[0].hotel.amenities).toContain('WIFI');
        expect(result.data[0].hotel.amenities).toContain('POOL');
        expect(result.data[0].offers[0].price.total).toBe('180.00');
      });

      it('should handle location autocomplete with fuzzy matching', async () => {
        const locationResponse = {
          data: [
            {
              type: 'location',
              subType: 'AIRPORT',
              name: 'John F Kennedy International Airport',
              detailedName: 'John F Kennedy International Airport, New York',
              id: 'JFK',
              iataCode: 'JFK',
              address: {
                cityName: 'New York',
                cityCode: 'NYC',
                countryName: 'United States',
                countryCode: 'US',
                regionCode: 'NAMER'
              },
              geoCode: {
                latitude: 40.63980103,
                longitude: -73.77890015
              },
              analytics: {
                travelers: {
                  score: 27
                }
              },
              relevance: 10.0
            },
            {
              type: 'location',
              subType: 'CITY',
              name: 'New York',
              detailedName: 'New York, United States',
              id: 'NYC',
              address: {
                cityName: 'New York',
                cityCode: 'NYC',
                countryName: 'United States',
                countryCode: 'US',
                regionCode: 'NAMER'
              },
              geoCode: {
                latitude: 40.71427,
                longitude: -74.00597
              },
              analytics: {
                travelers: {
                  score: 25
                }
              },
              relevance: 9.5
            }
          ],
          meta: {
            count: 2,
            links: {
              self: 'https://test.api.amadeus.com/v1/reference-data/locations?keyword=new%20york'
            }
          }
        };

        const locationScope = nock('https://test.api.amadeus.com')
          .get('/v1/reference-data/locations')
          .query({
            keyword: 'new york',
            subType: 'AIRPORT,CITY'
          })
          .reply(200, locationResponse);

        const result = await amadeusService.searchLocations('new york', ['AIRPORT', 'CITY']);

        expect(locationScope.isDone()).toBe(true);
        expect(result.data).toHaveLength(2);
        expect(result.data[0].iataCode).toBe('JFK');
        expect(result.data[1].name).toBe('New York');
        expect(result.data[0].relevance).toBeGreaterThan(result.data[1].relevance);
      });
    });

    describe('Error Handling Scenarios', () => {
      beforeEach(() => {
        nock('https://test.api.amadeus.com')
          .persist()
          .post('/v1/security/oauth2/token')
          .reply(200, {
            access_token: 'test-token',
            token_type: 'Bearer',
            expires_in: 1799
          });
      });

      it('should handle API validation errors gracefully', async () => {
        const validationErrorResponse = {
          errors: [
            {
              status: 400,
              code: 477,
              title: 'INVALID FORMAT',
              detail: 'Invalid date format',
              source: {
                parameter: 'departureDate',
                example: 'YYYY-MM-DD'
              }
            }
          ]
        };

        const errorScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(400, validationErrorResponse);

        await expect(amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: 'invalid-date',
          adults: 1,
          children: 0,
          travelClass: 'ECONOMY'
        })).rejects.toThrow('Invalid date format');

        expect(errorScope.isDone()).toBe(true);
      });

      it('should handle network timeouts with proper error messages', async () => {
        const timeoutScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .delayConnection(10000) // 10 second delay
          .reply(200, { data: [] });

        // Set a shorter timeout for testing
        const originalTimeout = (amadeusService as any).timeout;
        (amadeusService as any).timeout = 5000; // 5 seconds

        await expect(amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 1,
          children: 0,
          travelClass: 'ECONOMY'
        })).rejects.toThrow(/timeout/i);

        // Restore original timeout
        (amadeusService as any).timeout = originalTimeout;
        timeoutScope.done();
      });

      it('should handle server errors with retry logic', async () => {
        // First call returns 500
        const errorScope1 = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(500, {
            error: {
              status: 500,
              code: 38194,
              title: 'Internal Server Error'
            }
          });

        // Second call returns 503
        const errorScope2 = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(503, {
            error: {
              status: 503,
              code: 38195,
              title: 'Service Unavailable'
            }
          });

        // Third call succeeds
        const successScope = nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(200, {
            data: [{
              id: 'recovered-flight',
              price: { currency: 'USD', total: '800.00' }
            }],
            meta: { count: 1 }
          });

        const result = await amadeusService.searchFlights({
          origin: 'JFK',
          destination: 'CDG',
          departureDate: '2024-12-25',
          adults: 1,
          children: 0,
          travelClass: 'ECONOMY'
        });

        expect(errorScope1.isDone()).toBe(true);
        expect(errorScope2.isDone()).toBe(true);
        expect(successScope.isDone()).toBe(true);
        expect(result.data[0].id).toBe('recovered-flight');
      });
    });
  });

  describe('Claude AI API Integration', () => {
    describe('Itinerary Generation Scenarios', () => {
      it('should generate comprehensive itinerary with full context', async () => {
        const mockItinerary = {
          id: 'comprehensive-itinerary-123',
          overview: {
            title: '7-Day Paris Cultural Adventure',
            description: 'A comprehensive cultural exploration of Paris',
            highlights: ['Louvre Museum', 'Eiffel Tower', 'Seine River Cruise'],
            themes: ['Culture', 'Art', 'History']
          },
          totalBudget: {
            estimated: 3500,
            currency: 'USD',
            breakdown: {
              accommodation: 1400,
              activities: 1000,
              food: 800,
              transportation: 300
            },
            confidence: 0.85
          },
          dailyItinerary: [
            {
              day: 1,
              date: '2024-12-25',
              theme: 'Arrival and Classic Paris',
              location: 'Central Paris',
              activities: [
                {
                  time: '14:00',
                  duration: 120,
                  type: 'sightseeing',
                  title: 'Eiffel Tower Visit',
                  description: 'Visit the iconic Eiffel Tower with skip-the-line access',
                  location: { name: 'Eiffel Tower', address: 'Champ de Mars, 5 Avenue Anatole France' },
                  cost: { amount: 35, currency: 'USD', priceType: 'fixed' },
                  bookingInfo: { required: true, website: 'https://ticket.toureiffel.fr' },
                  accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
                  tips: ['Book tickets online', 'Visit during sunset for best photos'],
                  alternatives: ['Arc de Triomphe', 'Sacré-Cœur']
                }
              ],
              meals: [
                {
                  time: '19:30',
                  type: 'dinner',
                  restaurant: {
                    name: 'Le Procope',
                    cuisine: 'French Traditional',
                    location: '13 Rue de l\'Ancienne Comédie',
                    priceRange: '$$$',
                    atmosphere: 'Historic bistro'
                  },
                  estimatedCost: { amount: 85, currency: 'USD' },
                  reservationInfo: { required: true, phone: '+33 1 40 46 79 00' },
                  highlights: ['Historic venue', 'Traditional French cuisine'],
                  dietaryOptions: ['Vegetarian menu available']
                }
              ],
              transportation: [
                {
                  from: 'Charles de Gaulle Airport',
                  to: 'Hotel in Marais',
                  method: 'RER B + Metro',
                  duration: 75,
                  cost: { amount: 12, currency: 'USD' },
                  instructions: 'Take RER B to Châtelet-Les Halles, then Metro 1 to Saint-Paul',
                  alternatives: ['Taxi (45 min, €60)', 'Airport shuttle']
                }
              ],
              dailyBudget: {
                estimated: 150,
                breakdown: {
                  activities: 35,
                  food: 85,
                  transportation: 12,
                  miscellaneous: 18
                }
              },
              tips: ['Start with major attractions', 'Book dinner reservations early'],
              alternatives: []
            }
          ],
          generationMetadata: {
            model: 'claude-3-sonnet',
            confidence: 0.85,
            tokensUsed: 4500,
            generatedAt: new Date().toISOString(),
            version: '1.0'
          }
        };

        // Mock Anthropic API call
        const anthropicScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .matchHeader('x-api-key', 'test-anthropic-key')
          .matchHeader('anthropic-version', '2023-06-01')
          .reply(200, {
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: JSON.stringify(mockItinerary)
              }
            ],
            model: 'claude-3-sonnet-20240229',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 2000,
              output_tokens: 2500
            }
          });

        // Mock Redis cache miss
        mockRedisService.get.mockResolvedValue(null);
        mockRedisService.setex.mockResolvedValue('OK');

        const result = await claudeService.generateItinerary({
          destination: 'Paris, France',
          duration: 7,
          startDate: '2024-12-25',
          endDate: '2024-12-31',
          travelers: { adults: 2, children: 0 },
          budget: {
            total: 3500,
            currency: 'USD',
            categories: {
              accommodation: 1400,
              activities: 1000,
              food: 800,
              transportation: 300
            }
          },
          preferences: {
            interests: ['culture', 'art', 'history'],
            pace: 'moderate',
            accommodationType: 'hotel',
            diningPreferences: ['fine dining', 'traditional cuisine'],
            activityTypes: ['museums', 'monuments', 'cultural sites'],
            accessibility: { wheelchair: false, mobility: 'full' }
          },
          constraints: {
            avoidAreas: [],
            mustVisit: ['Eiffel Tower', 'Louvre Museum'],
            budgetConstraints: {
              maxMealCost: 100,
              maxActivityCost: 50
            }
          }
        });

        expect(anthropicScope.isDone()).toBe(true);
        expect(result.id).toBe('comprehensive-itinerary-123');
        expect(result.overview.title).toBe('7-Day Paris Cultural Adventure');
        expect(result.dailyItinerary).toHaveLength(1);
        expect(result.generationMetadata.tokensUsed).toBe(4500);
        expect(mockRedisService.setex).toHaveBeenCalled();
      });

      it('should handle itinerary refinement with user feedback', async () => {
        const originalItinerary = {
          id: 'original-itinerary-123',
          overview: { title: 'Original Itinerary' },
          dailyItinerary: [
            {
              day: 1,
              activities: [
                { title: 'Eiffel Tower', type: 'sightseeing' }
              ]
            }
          ]
        };

        const refinedItinerary = {
          ...originalItinerary,
          id: 'refined-itinerary-123',
          overview: { title: 'Refined Art-Focused Itinerary' },
          dailyItinerary: [
            {
              day: 1,
              activities: [
                { title: 'Louvre Museum', type: 'museum' },
                { title: 'Musée d\'Orsay', type: 'museum' }
              ]
            }
          ]
        };

        const refinementScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(200, {
            content: [{
              type: 'text',
              text: JSON.stringify(refinedItinerary)
            }],
            usage: { input_tokens: 1500, output_tokens: 1200 }
          });

        mockRedisService.get.mockResolvedValue(null);
        mockRedisService.setex.mockResolvedValue('OK');

        const result = await claudeService.refineItinerary(
          'original-itinerary-123',
          {
            refinementType: 'modify_preferences',
            userFeedback: 'I prefer art museums over tourist landmarks',
            details: {
              newInterests: ['art', 'museums'],
              removeActivities: ['Eiffel Tower'],
              addActivities: ['Louvre Museum', 'Musée d\'Orsay']
            }
          }
        );

        expect(refinementScope.isDone()).toBe(true);
        expect(result.id).toBe('refined-itinerary-123');
        expect(result.overview.title).toContain('Art-Focused');
        expect(result.dailyItinerary[0].activities).toHaveLength(2);
        expect(result.dailyItinerary[0].activities[0].title).toBe('Louvre Museum');
      });

      it('should handle streaming responses for real-time generation', async () => {
        const streamChunks = [
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{\\"id\\": \\"streaming-itinerary\\","}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"\\"overview\\": {\\"title\\": \\"Streaming Itinerary\\"}"}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"}"}}\n\n',
          'data: {"type":"content_block_stop","index":0}\n\n',
          'data: {"type":"message_stop"}\n\n'
        ];

        const streamScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .matchHeader('accept', 'text/event-stream')
          .reply(200, streamChunks.join(''), {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

        mockRedisService.get.mockResolvedValue(null);

        const result = await claudeService.generateItineraryStream({
          destination: 'Rome, Italy',
          duration: 3,
          startDate: '2024-06-01',
          endDate: '2024-06-03',
          travelers: { adults: 1, children: 0 },
          budget: { total: 1500, currency: 'USD' },
          preferences: {
            interests: ['history'],
            pace: 'moderate',
            accommodationType: 'hotel',
            diningPreferences: ['local cuisine'],
            activityTypes: ['historical sites'],
            accessibility: { wheelchair: false, mobility: 'full' }
          },
          constraints: {
            avoidAreas: [],
            mustVisit: [],
            budgetConstraints: { maxMealCost: 40, maxActivityCost: 25 }
          }
        });

        expect(streamScope.isDone()).toBe(true);
        expect(result.id).toBe('streaming-itinerary');
        expect(result.overview.title).toBe('Streaming Itinerary');
      });
    });

    describe('Claude API Error Handling', () => {
      it('should handle rate limiting with proper backoff', async () => {
        // First request hits rate limit
        const rateLimitScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(429, {
            type: 'error',
            error: {
              type: 'rate_limit_error',
              message: 'Rate limit exceeded'
            }
          }, {
            'Retry-After': '2'
          });

        // Second request succeeds after delay
        const successScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(200, {
            content: [{
              type: 'text',
              text: JSON.stringify({
                id: 'rate-limited-recovery',
                overview: { title: 'Recovered Itinerary' }
              })
            }],
            usage: { input_tokens: 1000, output_tokens: 500 }
          });

        mockRedisService.get.mockResolvedValue(null);
        mockRedisService.setex.mockResolvedValue('OK');

        const startTime = performance.now();

        const result = await claudeService.generateItinerary({
          destination: 'Barcelona, Spain',
          duration: 3,
          startDate: '2024-07-01',
          endDate: '2024-07-03',
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
            budgetConstraints: { maxMealCost: 50, maxActivityCost: 30 }
          }
        });

        const endTime = performance.now();
        const duration = endTime - startTime;

        expect(rateLimitScope.isDone()).toBe(true);
        expect(successScope.isDone()).toBe(true);
        expect(result.id).toBe('rate-limited-recovery');
        expect(duration).toBeGreaterThan(2000); // Should have waited
      });

      it('should handle content moderation and safety filters', async () => {
        const moderationScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(400, {
            type: 'error',
            error: {
              type: 'invalid_request_error',
              message: 'Content violates safety guidelines'
            }
          });

        mockRedisService.get.mockResolvedValue(null);

        await expect(claudeService.generateItinerary({
          destination: 'Dangerous Location',
          duration: 1,
          startDate: '2024-01-01',
          endDate: '2024-01-01',
          travelers: { adults: 1, children: 0 },
          budget: { total: 100, currency: 'USD' },
          preferences: {
            interests: ['illegal activities'], // This would trigger safety filters
            pace: 'fast',
            accommodationType: 'any',
            diningPreferences: ['any'],
            activityTypes: ['risky'],
            accessibility: { wheelchair: false, mobility: 'full' }
          },
          constraints: {
            avoidAreas: [],
            mustVisit: [],
            budgetConstraints: { maxMealCost: 10, maxActivityCost: 10 }
          }
        })).rejects.toThrow('Content violates safety guidelines');

        expect(moderationScope.isDone()).toBe(true);
      });

      it('should handle malformed JSON responses gracefully', async () => {
        const malformedScope = nock('https://api.anthropic.com')
          .post('/v1/messages')
          .reply(200, {
            content: [{
              type: 'text',
              text: '{ invalid json here: missing quotes and commas }'
            }],
            usage: { input_tokens: 1000, output_tokens: 50 }
          });

        mockRedisService.get.mockResolvedValue(null);

        await expect(claudeService.generateItinerary({
          destination: 'Valid Destination',
          duration: 3,
          startDate: '2024-08-01',
          endDate: '2024-08-03',
          travelers: { adults: 1, children: 0 },
          budget: { total: 1000, currency: 'USD' },
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
            budgetConstraints: { maxMealCost: 40, maxActivityCost: 30 }
          }
        })).rejects.toThrow(/JSON/);

        expect(malformedScope.isDone()).toBe(true);
      });
    });
  });

  describe('Firebase Integration', () => {
    describe('Authentication Management', () => {
      it('should create user with email and password', async () => {
        const mockUserRecord = {
          uid: 'firebase-user-123',
          email: 'test@example.com',
          emailVerified: false,
          displayName: 'Test User',
          photoURL: null,
          phoneNumber: null,
          disabled: false,
          metadata: {
            creationTime: new Date().toISOString(),
            lastSignInTime: null
          },
          customClaims: {},
          providerData: [
            {
              uid: 'test@example.com',
              displayName: 'Test User',
              email: 'test@example.com',
              photoURL: null,
              providerId: 'password'
            }
          ]
        };

        // Mock Firebase Admin SDK call
        const createUserSpy = jest.spyOn((firebaseService as any).auth, 'createUser')
          .mockResolvedValue(mockUserRecord);

        const result = await firebaseService.createUser({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          displayName: 'Test User'
        });

        expect(createUserSpy).toHaveBeenCalledWith({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          displayName: 'Test User'
        });
        expect(result.uid).toBe('firebase-user-123');
        expect(result.email).toBe('test@example.com');
        expect(result.emailVerified).toBe(false);

        createUserSpy.mockRestore();
      });

      it('should verify ID tokens and extract claims', async () => {
        const mockDecodedToken = {
          uid: 'verified-user-123',
          email: 'verified@example.com',
          email_verified: true,
          name: 'Verified User',
          picture: 'https://example.com/photo.jpg',
          iss: 'https://securetoken.google.com/test-project',
          aud: 'test-project',
          auth_time: Math.floor(Date.now() / 1000),
          user_id: 'verified-user-123',
          sub: 'verified-user-123',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          firebase: {
            identities: {
              email: ['verified@example.com']
            },
            sign_in_provider: 'password'
          }
        };

        const verifyTokenSpy = jest.spyOn((firebaseService as any).auth, 'verifyIdToken')
          .mockResolvedValue(mockDecodedToken);

        const result = await firebaseService.verifyIdToken('mock-id-token-jwt-here');

        expect(verifyTokenSpy).toHaveBeenCalledWith('mock-id-token-jwt-here');
        expect(result.uid).toBe('verified-user-123');
        expect(result.email).toBe('verified@example.com');
        expect(result.email_verified).toBe(true);

        verifyTokenSpy.mockRestore();
      });

      it('should handle custom claims and role-based access', async () => {
        const setCustomUserClaimsSpy = jest.spyOn((firebaseService as any).auth, 'setCustomUserClaims')
          .mockResolvedValue(undefined);

        await firebaseService.setUserRole('user-123', 'premium');

        expect(setCustomUserClaimsSpy).toHaveBeenCalledWith('user-123', {
          role: 'premium',
          permissions: ['create_itinerary', 'save_unlimited', 'export_pdf'],
          updatedAt: expect.any(String)
        });

        setCustomUserClaimsSpy.mockRestore();
      });

      it('should handle user deletion and cleanup', async () => {
        const deleteUserSpy = jest.spyOn((firebaseService as any).auth, 'deleteUser')
          .mockResolvedValue(undefined);

        // Mock Firestore cleanup
        const deleteDocSpy = jest.fn().mockResolvedValue(undefined);
        const collectionSpy = jest.fn().mockReturnValue({
          doc: jest.fn().mockReturnValue({
            delete: deleteDocSpy
          })
        });

        (firebaseService as any).firestore = {
          collection: collectionSpy
        };

        await firebaseService.deleteUser('user-to-delete-123');

        expect(deleteUserSpy).toHaveBeenCalledWith('user-to-delete-123');
        expect(collectionSpy).toHaveBeenCalledWith('users');
        expect(deleteDocSpy).toHaveBeenCalled();

        deleteUserSpy.mockRestore();
      });
    });

    describe('Firestore Data Operations', () => {
      it('should save and retrieve itinerary data', async () => {
        const mockItinerary = {
          id: 'firestore-itinerary-123',
          userId: 'user-123',
          title: 'Test Itinerary',
          destination: 'Tokyo, Japan',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Mock Firestore operations
        const setSpy = jest.fn().mockResolvedValue(undefined);
        const getSpy = jest.fn().mockResolvedValue({
          exists: true,
          data: () => mockItinerary
        });

        const docSpy = jest.fn().mockReturnValue({
          set: setSpy,
          get: getSpy
        });

        const collectionSpy = jest.fn().mockReturnValue({
          doc: docSpy
        });

        (firebaseService as any).firestore = {
          collection: collectionSpy
        };

        // Test save operation
        await firebaseService.saveItinerary(mockItinerary);

        expect(collectionSpy).toHaveBeenCalledWith('itineraries');
        expect(docSpy).toHaveBeenCalledWith('firestore-itinerary-123');
        expect(setSpy).toHaveBeenCalledWith(mockItinerary, { merge: true });

        // Test retrieve operation
        const retrieved = await firebaseService.getItinerary('firestore-itinerary-123');

        expect(getSpy).toHaveBeenCalled();
        expect(retrieved.id).toBe('firestore-itinerary-123');
        expect(retrieved.title).toBe('Test Itinerary');
      });

      it('should handle batch operations for multiple documents', async () => {
        const batchData = [
          { id: 'doc1', data: { title: 'Document 1' } },
          { id: 'doc2', data: { title: 'Document 2' } },
          { id: 'doc3', data: { title: 'Document 3' } }
        ];

        const commitSpy = jest.fn().mockResolvedValue(undefined);
        const setSpy = jest.fn();

        const batchSpy = jest.fn().mockReturnValue({
          set: setSpy,
          commit: commitSpy
        });

        const docSpy = jest.fn().mockImplementation((id) => ({ id }));
        const collectionSpy = jest.fn().mockReturnValue({ doc: docSpy });

        (firebaseService as any).firestore = {
          collection: collectionSpy,
          batch: batchSpy
        };

        await firebaseService.batchSaveDocuments('test-collection', batchData);

        expect(batchSpy).toHaveBeenCalled();
        expect(setSpy).toHaveBeenCalledTimes(3);
        expect(commitSpy).toHaveBeenCalled();

        batchData.forEach(item => {
          expect(docSpy).toHaveBeenCalledWith(item.id);
        });
      });

      it('should handle real-time subscriptions and updates', async () => {
        const mockCallback = jest.fn();
        const unsubscribeMock = jest.fn();

        const onSnapshotSpy = jest.fn().mockImplementation((callback) => {
          // Simulate real-time update
          setTimeout(() => {
            callback({
              docs: [
                {
                  id: 'doc1',
                  data: () => ({ title: 'Updated Document' })
                }
              ]
            });
          }, 100);
          return unsubscribeMock;
        });

        const whereSpy = jest.fn().mockReturnValue({
          onSnapshot: onSnapshotSpy
        });

        const collectionSpy = jest.fn().mockReturnValue({
          where: whereSpy
        });

        (firebaseService as any).firestore = {
          collection: collectionSpy
        };

        const unsubscribe = await firebaseService.subscribeToUserItineraries('user-123', mockCallback);

        expect(collectionSpy).toHaveBeenCalledWith('itineraries');
        expect(whereSpy).toHaveBeenCalledWith('userId', '==', 'user-123');
        expect(onSnapshotSpy).toHaveBeenCalled();

        // Wait for callback to be triggered
        await new Promise(resolve => setTimeout(resolve, 150));

        expect(mockCallback).toHaveBeenCalledWith([
          { id: 'doc1', title: 'Updated Document' }
        ]);

        // Test unsubscribe
        unsubscribe();
        expect(unsubscribeMock).toHaveBeenCalled();
      });
    });

    describe('Firebase Storage Operations', () => {
      it('should upload and download files', async () => {
        const mockFile = Buffer.from('test file content');
        const mockDownloadURL = 'https://storage.googleapis.com/test-bucket/file123.pdf';

        // Mock storage operations
        const getDownloadURLSpy = jest.fn().mockResolvedValue(mockDownloadURL);
        const uploadSpy = jest.fn().mockResolvedValue({
          ref: {
            getDownloadURL: getDownloadURLSpy
          }
        });

        const fileSpy = jest.fn().mockReturnValue({
          put: uploadSpy
        });

        const refSpy = jest.fn().mockReturnValue({
          child: fileSpy
        });

        (firebaseService as any).storage = {
          ref: refSpy
        };

        const downloadUrl = await firebaseService.uploadFile(
          mockFile,
          'itineraries/user-123/itinerary.pdf',
          'application/pdf'
        );

        expect(refSpy).toHaveBeenCalled();
        expect(fileSpy).toHaveBeenCalledWith('itineraries/user-123/itinerary.pdf');
        expect(uploadSpy).toHaveBeenCalledWith(mockFile, {
          contentType: 'application/pdf'
        });
        expect(getDownloadURLSpy).toHaveBeenCalled();
        expect(downloadUrl).toBe(mockDownloadURL);
      });

      it('should handle file deletion and cleanup', async () => {
        const deleteSpy = jest.fn().mockResolvedValue(undefined);

        const fileSpy = jest.fn().mockReturnValue({
          delete: deleteSpy
        });

        const refSpy = jest.fn().mockReturnValue({
          child: fileSpy
        });

        (firebaseService as any).storage = {
          ref: refSpy
        };

        await firebaseService.deleteFile('itineraries/user-123/old-itinerary.pdf');

        expect(refSpy).toHaveBeenCalled();
        expect(fileSpy).toHaveBeenCalledWith('itineraries/user-123/old-itinerary.pdf');
        expect(deleteSpy).toHaveBeenCalled();
      });
    });

    describe('Firebase Error Handling', () => {
      it('should handle authentication errors appropriately', async () => {
        const authError = new Error('Invalid credentials');
        (authError as any).code = 'auth/user-not-found';

        const getUserSpy = jest.spyOn((firebaseService as any).auth, 'getUser')
          .mockRejectedValue(authError);

        await expect(firebaseService.getUserById('non-existent-user'))
          .rejects.toThrow('Invalid credentials');

        expect(getUserSpy).toHaveBeenCalledWith('non-existent-user');

        getUserSpy.mockRestore();
      });

      it('should handle Firestore permission errors', async () => {
        const firestoreError = new Error('Permission denied');
        (firestoreError as any).code = 'permission-denied';

        const getSpy = jest.fn().mockRejectedValue(firestoreError);
        const docSpy = jest.fn().mockReturnValue({ get: getSpy });
        const collectionSpy = jest.fn().mockReturnValue({ doc: docSpy });

        (firebaseService as any).firestore = {
          collection: collectionSpy
        };

        await expect(firebaseService.getItinerary('restricted-itinerary'))
          .rejects.toThrow('Permission denied');

        expect(getSpy).toHaveBeenCalled();
      });

      it('should handle network connectivity issues', async () => {
        const networkError = new Error('Network request failed');
        (networkError as any).code = 'unavailable';

        const createUserSpy = jest.spyOn((firebaseService as any).auth, 'createUser')
          .mockRejectedValue(networkError);

        await expect(firebaseService.createUser({
          email: 'test@example.com',
          password: 'password123'
        })).rejects.toThrow('Network request failed');

        createUserSpy.mockRestore();
      });
    });
  });

  describe('Cross-Service Integration Scenarios', () => {
    it('should coordinate between all services for complete itinerary creation', async () => {
      // Setup successful responses from all services
      
      // 1. Firebase authentication
      const mockUser = { uid: 'coordinated-user-123', email: 'test@example.com' };
      const verifyTokenSpy = jest.spyOn((firebaseService as any).auth, 'verifyIdToken')
        .mockResolvedValue(mockUser);

      // 2. Amadeus flight search
      nock('https://test.api.amadeus.com')
        .post('/v1/security/oauth2/token')
        .reply(200, { access_token: 'amadeus-token', expires_in: 1799 })
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(200, {
          data: [{
            id: 'coordinated-flight',
            price: { currency: 'USD', total: '800.00' }
          }],
          meta: { count: 1 }
        });

      // 3. Claude itinerary generation
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: 'coordinated-itinerary',
              overview: { title: 'Coordinated Trip' },
              dailyItinerary: []
            })
          }],
          usage: { input_tokens: 1000, output_tokens: 500 }
        });

      // 4. Firebase data storage
      const setSpy = jest.fn().mockResolvedValue(undefined);
      const docSpy = jest.fn().mockReturnValue({ set: setSpy });
      const collectionSpy = jest.fn().mockReturnValue({ doc: docSpy });
      (firebaseService as any).firestore = { collection: collectionSpy };

      // Mock Redis cache
      mockRedisService.get.mockResolvedValue(null);
      mockRedisService.setex.mockResolvedValue('OK');

      // Execute coordinated workflow
      const user = await firebaseService.verifyIdToken('valid-jwt-token');
      expect(user.uid).toBe('coordinated-user-123');

      const flights = await amadeusService.searchFlights({
        origin: 'JFK',
        destination: 'CDG',
        departureDate: '2024-12-25',
        adults: 2,
        children: 0,
        travelClass: 'ECONOMY'
      });
      expect(flights.data[0].id).toBe('coordinated-flight');

      const itinerary = await claudeService.generateItinerary({
        destination: 'Paris, France',
        duration: 5,
        startDate: '2024-12-25',
        endDate: '2024-12-30',
        travelers: { adults: 2, children: 0 },
        budget: { total: 3000, currency: 'USD' },
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
          budgetConstraints: { maxMealCost: 50, maxActivityCost: 30 }
        },
        context: {
          selectedFlights: flights.data,
          user: user
        }
      });
      expect(itinerary.id).toBe('coordinated-itinerary');

      await firebaseService.saveItinerary({
        ...itinerary,
        userId: user.uid,
        flights: flights.data
      });

      expect(setSpy).toHaveBeenCalled();
      verifyTokenSpy.mockRestore();
    });

    it('should handle partial failures gracefully in coordinated operations', async () => {
      // Setup mixed success/failure responses
      
      // Firebase succeeds
      const mockUser = { uid: 'partial-user-123', email: 'partial@example.com' };
      const verifyTokenSpy = jest.spyOn((firebaseService as any).auth, 'verifyIdToken')
        .mockResolvedValue(mockUser);

      // Amadeus fails
      nock('https://test.api.amadeus.com')
        .post('/v1/security/oauth2/token')
        .reply(500, { error: 'Internal Server Error' });

      // Claude has fallback
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: 'fallback-itinerary',
              overview: { title: 'Basic Itinerary (No Flight Data)' },
              notice: 'Flight search unavailable - manual booking required'
            })
          }],
          usage: { input_tokens: 800, output_tokens: 300 }
        });

      mockRedisService.get.mockResolvedValue(null);
      mockRedisService.setex.mockResolvedValue('OK');

      // Execute workflow with failure handling
      const user = await firebaseService.verifyIdToken('valid-jwt-token');
      expect(user.uid).toBe('partial-user-123');

      // Flight search should fail
      await expect(amadeusService.searchFlights({
        origin: 'JFK',
        destination: 'CDG',
        departureDate: '2024-12-25',
        adults: 1,
        children: 0,
        travelClass: 'ECONOMY'
      })).rejects.toThrow();

      // Itinerary generation should still work with fallback
      const itinerary = await claudeService.generateItinerary({
        destination: 'Paris, France',
        duration: 3,
        startDate: '2024-12-25',
        endDate: '2024-12-27',
        travelers: { adults: 1, children: 0 },
        budget: { total: 1500, currency: 'USD' },
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
          budgetConstraints: { maxMealCost: 40, maxActivityCost: 25 }
        },
        context: {
          flightSearchFailed: true,
          user: user
        }
      });

      expect(itinerary.id).toBe('fallback-itinerary');
      expect(itinerary.notice).toContain('Flight search unavailable');

      verifyTokenSpy.mockRestore();
    });
  });
});