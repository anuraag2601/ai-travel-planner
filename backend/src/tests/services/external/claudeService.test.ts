import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ClaudeService, ItineraryGenerationParams } from '../../../services/external/claudeService.js';

// Mock dependencies
const mockAnthropicClient = {
  messages: {
    create: jest.fn()
  }
};

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn()
};

// Mock the external dependencies
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => mockAnthropicClient)
}));

jest.mock('../../../services/redis.js', () => ({
  RedisService: jest.fn(() => mockRedisService)
}));

jest.mock('../../../config/index.js', () => ({
  config: {
    anthropic: {
      apiKey: 'test-api-key',
      model: 'claude-3-sonnet-20240229',
      maxTokens: 4000,
      temperature: 0.7
    }
  }
}));

jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('ClaudeService', () => {
  let claudeService: ClaudeService;

  beforeEach(() => {
    jest.clearAllMocks();
    claudeService = new ClaudeService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateItinerary', () => {
    const mockItineraryParams: ItineraryGenerationParams = {
      destination: 'Paris',
      duration: 7,
      startDate: '2024-03-15',
      endDate: '2024-03-21',
      travelers: {
        adults: 2,
        children: 1
      },
      budget: {
        total: 5000,
        currency: 'USD',
        categories: {
          accommodation: 2000,
          activities: 1500,
          food: 1000,
          transportation: 500
        }
      },
      preferences: {
        interests: ['culture', 'museums', 'food'],
        pace: 'moderate',
        accommodationType: 'hotel',
        diningPreferences: ['local-cuisine'],
        activityTypes: ['guided-tours'],
        accessibility: {
          wheelchair: false,
          mobility: 'full'
        }
      },
      constraints: {
        avoidAreas: [],
        mustVisit: ['Eiffel Tower', 'Louvre Museum'],
        budgetConstraints: {
          maxMealCost: 100,
          maxActivityCost: 50
        }
      }
    };

    const mockItineraryResponse = {
      overview: {
        title: '7-Day Cultural Paris Adventure',
        description: 'A perfect blend of iconic landmarks and cultural experiences',
        highlights: ['Visit the Eiffel Tower', 'Explore the Louvre Museum'],
        themes: ['Cultural exploration']
      },
      totalBudget: {
        estimated: 4750,
        currency: 'USD',
        breakdown: {
          accommodation: 1890,
          activities: 1450,
          food: 980,
          transportation: 430
        },
        confidence: 0.9
      },
      dailyItinerary: [
        {
          day: 1,
          date: '2024-03-15',
          theme: 'Arrival and Central Paris',
          location: 'Paris',
          activities: [
            {
              time: '14:00',
              duration: 180,
              type: 'sightseeing',
              title: 'Eiffel Tower Visit',
              description: 'Visit the iconic Eiffel Tower',
              location: {
                name: 'Eiffel Tower',
                address: 'Champ de Mars, 5 Avenue Anatole France, 75007 Paris'
              },
              cost: {
                amount: 25,
                currency: 'USD',
                priceType: 'fixed'
              },
              bookingInfo: {
                required: false
              },
              accessibility: {
                wheelchairAccessible: true,
                mobilityFriendly: true
              },
              tips: ['Visit during sunset for best views'],
              alternatives: ['Arc de Triomphe']
            }
          ],
          meals: [],
          transportation: [],
          dailyBudget: {
            estimated: 150,
            breakdown: {
              activities: 50,
              food: 60,
              transportation: 30,
              miscellaneous: 10
            }
          },
          tips: ['Wear comfortable shoes'],
          alternatives: []
        }
      ],
      travelTips: {
        general: ['Learn basic French phrases'],
        cultural: ['Greet shopkeepers with Bonjour'],
        practical: ['Carry a reusable water bottle'],
        safety: ['Keep your belongings secure']
      },
      emergencyInfo: {
        emergency: '112',
        police: '17',
        medical: '15',
        embassy: {
          us: '+33 1 43 12 22 22'
        },
        hospitals: [
          {
            name: 'American Hospital of Paris',
            phone: '+33 1 46 41 25 25',
            address: '63 Bd Victor Hugo, 92200 Neuilly-sur-Seine'
          }
        ]
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
        model: 'claude-3-sonnet-20240229',
        confidence: 0.8,
        tokensUsed: 2500,
        generatedAt: '2024-01-15T10:30:00Z',
        version: '1.0'
      }
    };

    const mockClaudeResponse = {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(mockItineraryResponse)
        }
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 1000
      }
    };

    it('should return cached itinerary when available', async () => {
      const cachedResult = JSON.stringify(mockItineraryResponse);
      mockRedisService.get.mockResolvedValue(cachedResult);

      const result = await claudeService.generateItinerary(mockItineraryParams);

      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('itinerary:paris:7:2024-03-15')
      );
      expect(mockAnthropicClient.messages.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockItineraryResponse);
    });

    it('should generate new itinerary when not cached', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue(mockClaudeResponse);

      const result = await claudeService.generateItinerary(mockItineraryParams);

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('You are a professional travel planner')
          }
        ]
      });

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('itinerary:paris'),
        3600,
        expect.stringContaining('"title":"7-Day Cultural Paris Adventure"')
      );

      expect(result.overview.title).toBe('7-Day Cultural Paris Adventure');
      expect(result.generationMetadata.tokensUsed).toBe(2500);
    });

    it('should handle Claude API rate limit errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const rateLimitError = new Error('Rate limited');
      (rateLimitError as any).status = 429;
      mockAnthropicClient.messages.create.mockRejectedValue(rateLimitError);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('AI service rate limit exceeded. Please try again in a moment.');
    });

    it('should handle Claude API validation errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const validationError = new Error('Bad request');
      (validationError as any).status = 400;
      mockAnthropicClient.messages.create.mockRejectedValue(validationError);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('Invalid request parameters for itinerary generation.');
    });

    it('should handle generic Claude API errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const genericError = new Error('Generic error');
      mockAnthropicClient.messages.create.mockRejectedValue(genericError);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('Itinerary generation service temporarily unavailable.');
    });

    it('should return fallback itinerary when response parsing fails', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const invalidResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'Invalid JSON response'
          }
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 1000
        }
      };
      mockAnthropicClient.messages.create.mockResolvedValue(invalidResponse);

      const result = await claudeService.generateItinerary(mockItineraryParams);

      expect(result.overview.title).toBe('7-Day Paris Adventure');
      expect(result.generationMetadata.model).toBe('fallback');
      expect(result.generationMetadata.confidence).toBe(0.3);
    });

    it('should handle non-text response format', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const invalidResponse = {
        content: [
          {
            type: 'image' as any,
            text: 'This should not happen'
          }
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 1000
        }
      };
      mockAnthropicClient.messages.create.mockResolvedValue(invalidResponse);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('Unexpected response format from Claude API');
    });
  });

  describe('refineItinerary', () => {
    const mockOriginalItinerary = {
      overview: {
        title: 'Original Paris Trip',
        description: 'Original description',
        highlights: [],
        themes: []
      },
      totalBudget: {
        estimated: 5000,
        currency: 'USD',
        breakdown: {
          accommodation: 2000,
          activities: 1500,
          food: 1000,
          transportation: 500
        },
        confidence: 0.8
      },
      dailyItinerary: [
        {
          day: 1,
          date: '2024-03-15',
          theme: 'Day 1',
          location: 'Paris',
          activities: [],
          meals: [],
          transportation: [],
          dailyBudget: {
            estimated: 200,
            breakdown: {
              activities: 100,
              food: 60,
              transportation: 30,
              miscellaneous: 10
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
        model: 'claude-3-sonnet-20240229',
        confidence: 0.8,
        tokensUsed: 2000,
        generatedAt: '2024-01-15T10:00:00Z',
        version: '1.0'
      }
    };

    const mockRefinementRequest = {
      type: 'modify_activity' as const,
      details: {
        dayIndex: 0,
        newActivity: 'Museum visit instead of shopping'
      },
      userFeedback: 'I prefer museums over shopping'
    };

    it('should refine itinerary successfully', async () => {
      const refinedItinerary = {
        ...mockOriginalItinerary,
        overview: {
          ...mockOriginalItinerary.overview,
          title: 'Refined Paris Trip'
        }
      };

      const mockClaudeResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(refinedItinerary)
          }
        ],
        usage: {
          input_tokens: 2000,
          output_tokens: 1200
        }
      };

      mockAnthropicClient.messages.create.mockResolvedValue(mockClaudeResponse);

      const result = await claudeService.refineItinerary(mockOriginalItinerary, mockRefinementRequest);

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        temperature: 0.5,
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('You are a professional travel planner refining')
          }
        ]
      });

      expect(result.overview.title).toBe('Refined Paris Trip');
      expect(result.generationMetadata.tokensUsed).toBe(5200); // Original + new tokens
    });

    it('should handle refinement API errors', async () => {
      const error = new Error('Refinement failed');
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(claudeService.refineItinerary(mockOriginalItinerary, mockRefinementRequest))
        .rejects.toThrow('Unable to refine itinerary. Please try again.');
    });
  });

  describe('generateActivitySuggestions', () => {
    it('should generate activity suggestions successfully', async () => {
      const mockActivities = [
        {
          time: '10:00',
          duration: 120,
          type: 'museum',
          title: 'Louvre Museum',
          description: 'World famous art museum',
          location: {
            name: 'Louvre Museum',
            address: 'Rue de Rivoli, 75001 Paris'
          },
          cost: {
            amount: 15,
            currency: 'USD',
            priceType: 'fixed'
          },
          bookingInfo: {
            required: true
          },
          accessibility: {
            wheelchairAccessible: true,
            mobilityFriendly: true
          },
          tips: ['Book tickets in advance'],
          alternatives: ['Musée d\'Orsay']
        }
      ];

      const mockClaudeResponse = {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(mockActivities)
          }
        ],
        usage: {
          input_tokens: 500,
          output_tokens: 800
        }
      };

      mockAnthropicClient.messages.create.mockResolvedValue(mockClaudeResponse);

      const result = await claudeService.generateActivitySuggestions(
        'Paris', 
        ['museums', 'culture'], 
        1000, 
        7
      );

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        temperature: 0.8,
        messages: [
          {
            role: 'user',
            content: expect.stringContaining('Suggest 21 diverse activities for Paris')
          }
        ]
      });

      expect(result).toEqual(mockActivities);
    });

    it('should handle activity suggestions generation errors', async () => {
      const error = new Error('Activity generation failed');
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(claudeService.generateActivitySuggestions('Paris', ['culture'], 1000, 7))
        .rejects.toThrow('Unable to generate activity suggestions.');
    });

    it('should return empty array for invalid JSON response', async () => {
      const mockClaudeResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'Invalid JSON'
          }
        ],
        usage: {
          input_tokens: 500,
          output_tokens: 800
        }
      };

      mockAnthropicClient.messages.create.mockResolvedValue(mockClaudeResponse);

      const result = await claudeService.generateActivitySuggestions('Paris', ['culture'], 1000, 7);

      expect(result).toEqual([]);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Claude API is healthy', async () => {
      const mockHealthResponse = {
        content: [
          {
            type: 'text' as const,
            text: 'Hello!'
          }
        ],
        usage: {
          input_tokens: 5,
          output_tokens: 5
        }
      };

      mockAnthropicClient.messages.create.mockResolvedValue(mockHealthResponse);

      const result = await claudeService.healthCheck();

      expect(result).toBe(true);
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
      });
    });

    it('should return false when Claude API is unhealthy', async () => {
      mockAnthropicClient.messages.create.mockRejectedValue(new Error('API down'));

      const result = await claudeService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('cache key generation', () => {
    it('should generate consistent cache keys', async () => {
      const params1: ItineraryGenerationParams = {
        destination: 'Paris',
        duration: 7,
        startDate: '2024-03-15',
        endDate: '2024-03-21',
        travelers: { adults: 2, children: 1 },
        budget: {
          total: 5000,
          currency: 'USD',
          categories: { accommodation: 2000, activities: 1500, food: 1000, transportation: 500 }
        },
        preferences: {
          interests: ['culture', 'museums'],
          pace: 'moderate',
          accommodationType: 'hotel',
          diningPreferences: [],
          activityTypes: [],
          accessibility: { wheelchair: false, mobility: 'full' }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: [],
          budgetConstraints: { maxMealCost: 100, maxActivityCost: 50 }
        }
      };

      const params2 = { ...params1 };

      mockRedisService.get.mockResolvedValue(JSON.stringify({ test: 'data' }));

      await claudeService.generateItinerary(params1);
      const firstCall = mockRedisService.get.mock.calls[0][0];

      await claudeService.generateItinerary(params2);
      const secondCall = mockRedisService.get.mock.calls[1][0];

      expect(firstCall).toBe(secondCall);
    });
  });
});