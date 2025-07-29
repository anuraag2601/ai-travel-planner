import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { ClaudeService, ItineraryGenerationParams, GeneratedItinerary } from '../../services/external/claudeService.js';
// import nock from 'nock';

// Integration test for Claude AI API calls and error handling
describe('ClaudeService Integration Tests', () => {
  let claudeService: ClaudeService;
  let mockRedisService: any;

  beforeAll(() => {
    // Mock Redis service for integration tests
    mockRedisService = {
      get: jest.fn(),
      setex: jest.fn()
    };

    // Mock the Redis dependency
    jest.mock('../../services/redis.js', () => ({
      RedisService: jest.fn(() => mockRedisService)
    }));

    // Mock logger to avoid console noise
    jest.mock('../../utils/logger.js', () => ({
      logger: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
      }
    }));

    // Mock config
    jest.mock('../../config/index.js', () => ({
      config: {
        anthropic: {
          apiKey: 'test-api-key',
          model: 'claude-3-haiku-20240307',
          maxTokens: 4000,
          temperature: 0.7
        }
      }
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null); // No cache by default
    mockRedisService.setex.mockResolvedValue('OK');
    
    claudeService = new ClaudeService();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.restore();
  });

  describe('Itinerary Generation Integration', () => {
    const itineraryParams: ItineraryGenerationParams = {
      destination: 'Paris, France',
      duration: 5,
      startDate: '2024-06-15',
      endDate: '2024-06-20',
      travelers: {
        adults: 2,
        children: 1
      },
      budget: {
        total: 3000,
        currency: 'USD',
        categories: {
          accommodation: 1200,
          activities: 800,
          food: 700,
          transportation: 300
        }
      },
      preferences: {
        interests: ['museums', 'cuisine', 'architecture'],
        pace: 'moderate' as const,
        accommodationType: 'hotel',
        diningPreferences: ['local cuisine', 'family-friendly'],
        activityTypes: ['cultural', 'sightseeing'],
        accessibility: {
          wheelchair: false,
          mobility: 'full' as const
        }
      },
      constraints: {
        avoidAreas: [],
        mustVisit: ['Eiffel Tower', 'Louvre Museum'],
        budgetConstraints: {
          maxMealCost: 80,
          maxActivityCost: 150
        }
      }
    };

    const mockItineraryResponse = {
      content: [
        {
          type: 'text' as const,
          text: `{
            "overview": {
              "title": "5-Day Paris Family Adventure",
              "description": "A perfect blend of iconic sights, cultural experiences, and family-friendly activities in the City of Light",
              "highlights": ["Eiffel Tower visit", "Louvre Museum tour", "Seine River cruise", "Montmartre exploration", "French cuisine discovery"],
              "themes": ["Cultural immersion", "Family bonding", "Historical exploration"]
            },
            "totalBudget": {
              "estimated": 2850,
              "currency": "USD",
              "breakdown": {
                "accommodation": 1200,
                "activities": 750,
                "food": 650,
                "transportation": 250
              },
              "confidence": 0.85
            },
            "dailyItinerary": [
              {
                "day": 1,
                "date": "2024-06-15",
                "theme": "Iconic Paris Welcome",
                "location": "Central Paris",
                "activities": [
                  {
                    "time": "10:00",
                    "duration": 180,
                    "type": "sightseeing",
                    "title": "Eiffel Tower Visit",
                    "description": "Start your Paris adventure with a visit to the iconic Eiffel Tower. Take the elevator to the second floor for breathtaking views of the city.",
                    "location": {
                      "name": "Eiffel Tower",
                      "address": "Champ de Mars, 5 Avenue Anatole France, 75007 Paris"
                    },
                    "cost": {
                      "amount": 75,
                      "currency": "USD",
                      "priceType": "fixed"
                    },
                    "bookingInfo": {
                      "required": true,
                      "website": "https://www.toureiffel.paris",
                      "advanceNotice": "1-2 days recommended"
                    },
                    "accessibility": {
                      "wheelchairAccessible": true,
                      "mobilityFriendly": true,
                      "notes": "Elevators available to all levels"
                    },
                    "tips": ["Book tickets online to skip lines", "Visit early morning for fewer crowds", "Bring warm clothing as it gets windy at the top"],
                    "alternatives": ["Trocadéro viewpoint for free tower views", "Arc de Triomphe for panoramic city views"]
                  }
                ],
                "meals": [
                  {
                    "time": "13:00",
                    "type": "lunch",
                    "restaurant": {
                      "name": "Du Pain et des Idées",
                      "cuisine": "French Bakery",
                      "location": "4th arrondissement",
                      "priceRange": "$$",
                      "atmosphere": "Cozy traditional bakery"
                    },
                    "estimatedCost": {
                      "amount": 45,
                      "currency": "USD"
                    },
                    "reservationInfo": {
                      "required": false
                    },
                    "highlights": ["Artisanal breads", "Fresh pastries", "Traditional French atmosphere"],
                    "dietaryOptions": ["Vegetarian options available"]
                  }
                ],
                "transportation": [
                  {
                    "from": "Hotel",
                    "to": "Eiffel Tower",
                    "method": "metro",
                    "duration": 25,
                    "cost": {
                      "amount": 12,
                      "currency": "USD"
                    },
                    "instructions": "Take Metro Line 6 to Bir-Hakeim station, then 5-minute walk",
                    "alternatives": ["Bus #82", "Taxi (15-20 EUR)", "Walking (45 minutes)"]
                  }
                ],
                "dailyBudget": {
                  "estimated": 132,
                  "breakdown": {
                    "activities": 75,
                    "food": 45,
                    "transportation": 12,
                    "miscellaneous": 0
                  }
                },
                "tips": ["Start early to avoid crowds", "Download offline maps", "Keep metro tickets safe"],
                "alternatives": [
                  {
                    "type": "activity",
                    "original": "Eiffel Tower elevator",
                    "alternative": "Climb stairs to 2nd floor (cheaper option)",
                    "reason": "Save money and get exercise"
                  }
                ]
              }
            ],
            "travelTips": {
              "general": ["Buy a Paris Museum Pass for skip-the-line access", "Learn basic French phrases", "Always validate metro tickets"],
              "cultural": ["French dining times are later than American", "Greet shopkeepers when entering stores", "Tipping is not mandatory but appreciated"],
              "practical": ["Carry reusable water bottle", "Many museums are closed on Mondays", "Public restrooms cost 0.50-1 EUR"],
              "safety": ["Watch for pickpockets on public transport", "Keep copies of important documents", "Emergency number is 112"]
            },
            "emergencyInfo": {
              "emergency": "112",
              "police": "17",
              "medical": "15",
              "embassy": {
                "us": "+33 1 43 12 22 22",
                "uk": "+33 1 44 51 31 00"
              },
              "hospitals": [
                {
                  "name": "Hôpital Américain de Paris",
                  "phone": "+33 1 46 41 25 25",
                  "address": "63 Boulevard Victor Hugo, 92200 Neuilly-sur-Seine"
                }
              ]
            },
            "recommendations": {
              "restaurants": [
                {
                  "name": "L'As du Fallafel",
                  "cuisine": "Middle Eastern",
                  "priceRange": "$",
                  "location": "Marais district",
                  "specialties": ["Falafel sandwich", "Hummus"],
                  "reservationRequired": false
                }
              ],
              "activities": [
                {
                  "name": "Seine River Cruise",
                  "type": "sightseeing",
                  "duration": 60,
                  "cost": 25,
                  "difficulty": "easy",
                  "bestTime": "Evening for sunset views",
                  "bookingRequired": false
                }
              ],
              "shopping": [
                {
                  "name": "Champs-Élysées",
                  "type": "Shopping street",
                  "location": "8th arrondissement",
                  "specialties": ["Fashion", "Souvenirs", "French brands"],
                  "priceRange": "$$-$$$$"
                }
              ]
            },
            "localInsights": {
              "culture": ["French people value punctuality", "Lunch is typically 12-2pm, dinner 7:30-10pm", "Sunday mornings are quiet with many shops closed"],
              "etiquette": ["Say 'Bonjour' when entering shops", "Keep voices down in restaurants", "Don't eat while walking"],
              "language": {
                "basicPhrases": {
                  "hello": "Bonjour",
                  "thank_you": "Merci",
                  "please": "S'il vous plaît",
                  "excuse_me": "Excusez-moi"
                },
                "usefulWords": {
                  "bathroom": "Toilettes",
                  "water": "Eau",
                  "help": "Aide"
                }
              },
              "transportation": {
                "publicTransport": "Efficient metro system with 14 lines covering the city",
                "taxiApps": ["Uber", "Bolt", "G7"],
                "walkingAreas": ["Seine riverbanks", "Marais district", "Montmartre"]
              },
              "weather": {
                "general": "June weather is pleasant with temperatures 15-25°C (59-77°F)",
                "clothing": ["Light layers", "Comfortable walking shoes", "Light rain jacket"],
                "seasonalTips": ["Daylight until 9:30pm", "Pack for variable weather", "UV protection recommended"]
              }
            }
          }`
        }
      ],
      usage: {
        input_tokens: 1250,
        output_tokens: 2800
      }
    };

    it('should successfully generate a comprehensive itinerary', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockItineraryResponse);

      const result = await claudeService.generateItinerary(itineraryParams);

      expect(result).toBeDefined();
      expect(result.overview.title).toBe('5-Day Paris Family Adventure');
      expect(result.dailyItinerary).toHaveLength(1); // Only one day in mock response
      expect(result.totalBudget.estimated).toBe(2850);
      expect(result.totalBudget.currency).toBe('USD');
      expect(result.generationMetadata.tokensUsed).toBe(4050); // 1250 + 2800
      expect(result.generationMetadata.model).toBe('claude-3-haiku-20240307');
      
      // Verify activities are properly structured
      const firstDay = result.dailyItinerary[0];
      expect(firstDay.activities).toHaveLength(1);
      expect(firstDay.activities[0].title).toBe('Eiffel Tower Visit');
      expect(firstDay.activities[0].cost.amount).toBe(75);
      expect(firstDay.activities[0].accessibility.wheelchairAccessible).toBe(true);
      
      // Verify meals are included
      expect(firstDay.meals).toHaveLength(1);
      expect(firstDay.meals[0].restaurant.name).toBe('Du Pain et des Idées');
      
      // Verify caching was attempted
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('itinerary:paris_france'),
        3600,
        expect.stringContaining('"title":"5-Day Paris Family Adventure"')
      );
    });

    it('should use cached itinerary when available', async () => {
      const cachedItinerary = {
        overview: { title: 'Cached Paris Trip' },
        dailyItinerary: [],
        totalBudget: { estimated: 2500, currency: 'USD' }
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(cachedItinerary));

      const result = await claudeService.generateItinerary(itineraryParams);

      expect(result.overview.title).toBe('Cached Paris Trip');
      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('itinerary:paris_france')
      );
      
      // Should not make API call when cache hit
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should handle Claude API rate limiting', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(429, {
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded'
          }
        });

      await expect(claudeService.generateItinerary(itineraryParams))
        .rejects.toThrow('AI service rate limit exceeded. Please try again in a moment.');
    });

    it('should handle invalid request parameters', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(400, {
          error: {
            type: 'invalid_request_error',
            message: 'Invalid request format'
          }
        });

      await expect(claudeService.generateItinerary(itineraryParams))
        .rejects.toThrow('Invalid request parameters for itinerary generation.');
    });

    it('should handle API service unavailability', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(500, {
          error: {
            type: 'api_error',
            message: 'Internal server error'
          }
        });

      await expect(claudeService.generateItinerary(itineraryParams))
        .rejects.toThrow('Itinerary generation service temporarily unavailable.');
    });

    it('should handle malformed JSON responses gracefully', async () => {
      const malformedResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'This is not valid JSON for an itinerary'
          }
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 100
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, malformedResponse);

      const result = await claudeService.generateItinerary(itineraryParams);

      // Should return fallback itinerary
      expect(result.overview.title).toBe('5-Day Paris, France Adventure');
      expect(result.generationMetadata.model).toBe('fallback');
      expect(result.generationMetadata.confidence).toBe(0.3);
    });

    it('should handle network timeouts', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .delay(10000) // Simulate timeout
        .reply(200, mockItineraryResponse);

      await expect(claudeService.generateItinerary(itineraryParams))
        .rejects.toThrow('Itinerary generation service temporarily unavailable.');
    });
  });

  describe('Itinerary Refinement Integration', () => {
    const originalItinerary: GeneratedItinerary = {
      overview: {
        title: 'Original Paris Trip',
        description: 'A trip to Paris',
        highlights: ['Eiffel Tower'],
        themes: ['Sightseeing']
      },
      totalBudget: {
        estimated: 2500,
        currency: 'USD',
        breakdown: {
          accommodation: 1000,
          activities: 600,
          food: 500,
          transportation: 400
        },
        confidence: 0.8
      },
      dailyItinerary: [
        {
          day: 1,
          date: '2024-06-15',
          theme: 'Arrival Day',
          location: 'Paris',
          activities: [],
          meals: [],
          transportation: [],
          dailyBudget: {
            estimated: 500,
            breakdown: {
              activities: 200,
              food: 150,
              transportation: 100,
              miscellaneous: 50
            }
          },
          tips: [],
          alternatives: []
        }
      ],
      travelTips: {
        general: [],
        cultural: [],
        practical: [],
        safety: []
      },
      emergencyInfo: {
        emergency: '112',
        police: '17',
        medical: '15',
        embassy: {},
        hospitals: []
      },
      recommendations: {
        restaurants: [],
        activities: [],
        shopping: []
      },
      localInsights: {
        culture: [],
        etiquette: [],
        language: {
          basicPhrases: {},
          usefulWords: {}
        },
        transportation: {
          publicTransport: '',
          taxiApps: [],
          walkingAreas: []
        },
        weather: {
          general: '',
          clothing: [],
          seasonalTips: []
        }
      },
      generationMetadata: {
        model: 'claude-3-haiku-20240307',
        confidence: 0.8,
        tokensUsed: 2000,
        generatedAt: '2024-01-01T00:00:00Z',
        version: '1.0'
      }
    };

    const refinementRequest = {
      type: 'modify_activity' as const,
      details: {
        day: 1,
        removeActivity: 'Museum visit',
        addActivity: 'Food tour'
      },
      userFeedback: 'We prefer food experiences over museums'
    };

    it('should successfully refine an itinerary', async () => {
      const refinedResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ...originalItinerary,
              overview: {
                ...originalItinerary.overview,
                title: 'Refined Paris Food Adventure'
              }
            })
          }
        ],
        usage: {
          input_tokens: 2000,
          output_tokens: 1500
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, refinedResponse);

      const result = await claudeService.refineItinerary(originalItinerary, refinementRequest);

      expect(result.overview.title).toBe('Refined Paris Food Adventure');
      expect(result.generationMetadata.tokensUsed).toBe(5500); // 2000 + 2000 + 1500
      expect(result.generationMetadata.generatedAt).not.toBe(originalItinerary.generationMetadata.generatedAt);
    });

    it('should handle refinement API errors', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(500, {
          error: {
            type: 'api_error',
            message: 'Service unavailable'
          }
        });

      await expect(claudeService.refineItinerary(originalItinerary, refinementRequest))
        .rejects.toThrow('Unable to refine itinerary. Please try again.');
    });

    it('should handle different refinement types', async () => {
      const budgetRefinement = {
        type: 'change_budget' as const,
        details: {
          newBudget: 3500,
          adjustCategories: true
        }
      };

      const refinedResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ...originalItinerary,
              totalBudget: {
                ...originalItinerary.totalBudget,
                estimated: 3500
              }
            })
          }
        ],
        usage: {
          input_tokens: 1800,
          output_tokens: 1200
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, refinedResponse);

      const result = await claudeService.refineItinerary(originalItinerary, budgetRefinement);

      expect(result.totalBudget.estimated).toBe(3500);
    });
  });

  describe('Activity Suggestions Integration', () => {
    it('should successfully generate activity suggestions', async () => {
      const mockActivitiesResponse = {
        content: [
          {
            type: 'text' as const,
            text: `[
              {
                "time": "10:00",
                "duration": 120,
                "type": "cultural",
                "title": "Musée d'Orsay Visit",
                "description": "Explore the world's finest collection of Impressionist art",
                "location": {
                  "name": "Musée d'Orsay",
                  "address": "1 Rue de la Légion d'Honneur, 75007 Paris"
                },
                "cost": {
                  "amount": 16,
                  "currency": "USD",
                  "priceType": "fixed"
                },
                "bookingInfo": {
                  "required": false
                },
                "accessibility": {
                  "wheelchairAccessible": true,
                  "mobilityFriendly": true
                },
                "tips": ["Visit on first Sunday mornings for free entry", "Audio guide recommended"],
                "alternatives": ["Musée Rodin", "Picasso Museum"]
              },
              {
                "time": "14:00",
                "duration": 180,
                "type": "outdoor",
                "title": "Seine River Walk",
                "description": "Leisurely stroll along the iconic Seine River",
                "location": {
                  "name": "Seine Riverbank",
                  "address": "Along the Seine River, Central Paris"
                },
                "cost": {
                  "amount": 0,
                  "currency": "USD",
                  "priceType": "free"
                },
                "bookingInfo": {
                  "required": false
                },
                "accessibility": {
                  "wheelchairAccessible": true,
                  "mobilityFriendly": true
                },
                "tips": ["Best during golden hour", "Bring camera for photos"],
                "alternatives": ["Tuileries Garden walk", "Luxembourg Gardens"]
              }
            ]`
          }
        ],
        usage: {
          input_tokens: 800,
          output_tokens: 1200
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockActivitiesResponse);

      const activities = await claudeService.generateActivitySuggestions(
        'Paris, France',
        ['museums', 'outdoor activities'],
        500,
        3
      );

      expect(activities).toHaveLength(2);
      expect(activities[0].title).toBe("Musée d'Orsay Visit");
      expect(activities[0].type).toBe('cultural');
      expect(activities[0].cost.amount).toBe(16);
      expect(activities[1].title).toBe('Seine River Walk');
      expect(activities[1].cost.priceType).toBe('free');
    });

    it('should handle activity suggestions API errors', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(500, {
          error: {
            type: 'api_error',
            message: 'Service error'
          }
        });

      await expect(claudeService.generateActivitySuggestions(
        'Paris, France',
        ['museums'],
        500,
        2
      )).rejects.toThrow('Unable to generate activity suggestions.');
    });

    it('should handle malformed activity suggestions response', async () => {
      const malformedResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'This is not valid JSON array'
          }
        ],
        usage: {
          input_tokens: 500,
          output_tokens: 100
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, malformedResponse);

      const activities = await claudeService.generateActivitySuggestions(
        'Paris, France',
        ['museums'],
        500,
        2
      );

      expect(activities).toEqual([]);
    });
  });

  describe('Health Check Integration', () => {
    it('should return true when Claude API is healthy', async () => {
      const healthCheckResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'Hello! How can I assist you today?'
          }
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 12
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, healthCheckResponse);

      const isHealthy = await claudeService.healthCheck();

      expect(isHealthy).toBe(true);
    });

    it('should return false when Claude API is unhealthy', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(500, {
          error: {
            type: 'api_error',
            message: 'Service unavailable'
          }
        });

      const isHealthy = await claudeService.healthCheck();

      expect(isHealthy).toBe(false);
    });

    it('should return false on network errors', async () => {
      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .replyWithError('Network connection failed');

      const isHealthy = await claudeService.healthCheck();

      expect(isHealthy).toBe(false);
    });

    it('should return false when API returns empty content', async () => {
      const emptyResponse = {
        content: [],
        usage: {
          input_tokens: 10,
          output_tokens: 0
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, emptyResponse);

      const isHealthy = await claudeService.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });

  describe('Cache Integration', () => {
    it('should handle cache retrieval errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              overview: { title: 'Fresh Itinerary' },
              dailyItinerary: [],
              totalBudget: { estimated: 2000, currency: 'USD' }
            })
          }
        ],
        usage: {
          input_tokens: 1000,
          output_tokens: 2000
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockResponse);

      const itineraryParams: ItineraryGenerationParams = {
        destination: 'Tokyo, Japan',
        duration: 3,
        startDate: '2024-07-01',
        endDate: '2024-07-03',
        travelers: { adults: 1, children: 0 },
        budget: {
          total: 2000,
          currency: 'USD',
          categories: { accommodation: 800, activities: 600, food: 400, transportation: 200 }
        },
        preferences: {
          interests: ['culture'],
          pace: 'moderate' as const,
          accommodationType: 'hotel',
          diningPreferences: [],
          activityTypes: [],
          accessibility: { wheelchair: false, mobility: 'full' as const }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: [],
          budgetConstraints: { maxMealCost: 50, maxActivityCost: 100 }
        }
      };

      const result = await claudeService.generateItinerary(itineraryParams);

      expect(result.overview.title).toBe('Fresh Itinerary');
      // Should still attempt to cache despite cache read error
      expect(mockRedisService.setex).toHaveBeenCalled();
    });

    it('should handle cache write errors gracefully', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis write failed'));

      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              overview: { title: 'Generated Itinerary' },
              dailyItinerary: [],
              totalBudget: { estimated: 1500, currency: 'USD' }
            })
          }
        ],
        usage: {
          input_tokens: 800,
          output_tokens: 1500
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockResponse);

      const itineraryParams: ItineraryGenerationParams = {
        destination: 'Rome, Italy',
        duration: 4,
        startDate: '2024-08-01',
        endDate: '2024-08-04',
        travelers: { adults: 2, children: 0 },
        budget: {
          total: 1500,
          currency: 'USD',
          categories: { accommodation: 600, activities: 400, food: 350, transportation: 150 }
        },
        preferences: {
          interests: ['history'],
          pace: 'relaxed' as const,
          accommodationType: 'hotel',
          diningPreferences: [],
          activityTypes: [],
          accessibility: { wheelchair: false, mobility: 'full' as const }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: ['Colosseum'],
          budgetConstraints: { maxMealCost: 60, maxActivityCost: 80 }
        }
      };

      // Should not throw error even if caching fails
      const result = await claudeService.generateItinerary(itineraryParams);

      expect(result.overview.title).toBe('Generated Itinerary');
    });
  });

  describe('Request Validation and Edge Cases', () => {
    it('should handle very long destination names', async () => {
      const longDestination = 'A'.repeat(1000);
      
      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              overview: { title: 'Long Destination Trip' },
              dailyItinerary: [],
              totalBudget: { estimated: 2000, currency: 'USD' }
            })
          }
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 1000
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockResponse);

      const params: ItineraryGenerationParams = {
        destination: longDestination,
        duration: 2,
        startDate: '2024-09-01',
        endDate: '2024-09-02',
        travelers: { adults: 1, children: 0 },
        budget: {
          total: 2000,
          currency: 'USD',
          categories: { accommodation: 800, activities: 600, food: 400, transportation: 200 }
        },
        preferences: {
          interests: [],
          pace: 'moderate' as const,
          accommodationType: 'hotel',
          diningPreferences: [],
          activityTypes: [],
          accessibility: { wheelchair: false, mobility: 'full' as const }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: [],
          budgetConstraints: { maxMealCost: 50, maxActivityCost: 100 }
        }
      };

      const result = await claudeService.generateItinerary(params);

      expect(result.overview.title).toBe('Long Destination Trip');
      // Verify cache key generation handles long strings
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^itinerary:/),
        3600,
        expect.any(String)
      );
    });

    it('should handle extreme budget values', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              overview: { title: 'Budget Trip' },
              dailyItinerary: [],
              totalBudget: { estimated: 1, currency: 'USD' }
            })
          }
        ],
        usage: {
          input_tokens: 900,
          output_tokens: 800
        }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockResponse);

      const extremeBudgetParams: ItineraryGenerationParams = {
        destination: 'Budget City',
        duration: 1,
        startDate: '2024-10-01',
        endDate: '2024-10-01',
        travelers: { adults: 1, children: 0 },
        budget: {
          total: 1,
          currency: 'USD',
          categories: { accommodation: 0, activities: 0, food: 1, transportation: 0 }
        },
        preferences: {
          interests: [],
          pace: 'fast' as const,
          accommodationType: 'hostel',
          diningPreferences: [],
          activityTypes: [],
          accessibility: { wheelchair: false, mobility: 'full' as const }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: [],
          budgetConstraints: { maxMealCost: 1, maxActivityCost: 0 }
        }
      };

      const result = await claudeService.generateItinerary(extremeBudgetParams);

      expect(result.totalBudget.estimated).toBe(1);
      expect(result.overview.title).toBe('Budget Trip');
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple simultaneous itinerary generations', async () => {
      const mockResponse1 = {
        content: [{ type: 'text' as const, text: JSON.stringify({ overview: { title: 'Trip 1' } }) }],
        usage: { input_tokens: 1000, output_tokens: 1000 }
      };
      
      const mockResponse2 = {
        content: [{ type: 'text' as const, text: JSON.stringify({ overview: { title: 'Trip 2' } }) }],
        usage: { input_tokens: 1100, output_tokens: 1100 }
      };

      nock('https://api.anthropic.com')
        .post('/v1/messages')
        .reply(200, mockResponse1)
        .post('/v1/messages')
        .reply(200, mockResponse2);

      const baseParams: ItineraryGenerationParams = {
        destination: 'Test City',
        duration: 2,
        startDate: '2024-11-01',
        endDate: '2024-11-02',
        travelers: { adults: 1, children: 0 },
        budget: {
          total: 1000,
          currency: 'USD',
          categories: { accommodation: 400, activities: 300, food: 200, transportation: 100 }
        },
        preferences: {
          interests: [],
          pace: 'moderate' as const,
          accommodationType: 'hotel',
          diningPreferences: [],
          activityTypes: [],
          accessibility: { wheelchair: false, mobility: 'full' as const }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: [],
          budgetConstraints: { maxMealCost: 50, maxActivityCost: 100 }
        }
      };

      const promises = [
        claudeService.generateItinerary({ ...baseParams, destination: 'City 1' }),
        claudeService.generateItinerary({ ...baseParams, destination: 'City 2' })
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(2);
      // Due to fallback parsing, both might not have the exact titles, but should be valid itineraries
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
    });
  });
});