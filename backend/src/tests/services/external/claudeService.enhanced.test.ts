import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ClaudeService, ItineraryGenerationParams, GeneratedItinerary } from '../../../services/external/claudeService.js';

// Mock dependencies
const mockAnthropicClient = {
  messages: {
    create: jest.fn()
  }
};

const mockRedisService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  setex: jest.fn(),
  exists: jest.fn()
};

jest.mock('../../../services/redis.js', () => ({
  RedisService: jest.fn(() => mockRedisService)
}));

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => mockAnthropicClient)
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

describe('ClaudeService Enhanced Unit Tests', () => {
  let claudeService: ClaudeService;

  const mockItineraryParams: ItineraryGenerationParams = {
    destination: 'Paris, France',
    duration: 5,
    startDate: '2024-12-25',
    endDate: '2024-12-30',
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
        food: 600,
        transportation: 400
      }
    },
    preferences: {
      interests: ['museums', 'food', 'architecture'],
      pace: 'moderate',
      accommodationType: 'hotel',
      diningPreferences: ['local cuisine', 'vegetarian options'],
      activityTypes: ['cultural', 'outdoor'],
      accessibility: {
        wheelchair: false,
        mobility: 'full'
      }
    },
    constraints: {
      avoidAreas: ['tourist traps'],
      mustVisit: ['Eiffel Tower', 'Louvre Museum'],
      budgetConstraints: {
        maxMealCost: 50,
        maxActivityCost: 100
      }
    }
  };

  const mockGeneratedItinerary: GeneratedItinerary = {
    overview: {
      title: '5-Day Romantic Paris Adventure',
      description: 'Experience the magic of Paris with cultural exploration and culinary delights',
      highlights: ['Eiffel Tower visit', 'Louvre Museum tour', 'Seine river cruise'],
      themes: ['Romance', 'Culture', 'Cuisine']
    },
    totalBudget: {
      estimated: 2800,
      currency: 'USD',
      breakdown: {
        accommodation: 1200,
        activities: 700,
        food: 500,
        transportation: 400
      },
      confidence: 0.85
    },
    dailyItinerary: [
      {
        day: 1,
        date: '2024-12-25',
        theme: 'Arrival and Central Paris',
        location: 'Central Paris',
        activities: [
          {
            time: '10:00',
            duration: 120,
            type: 'sightseeing',
            title: 'Eiffel Tower Visit',
            description: 'Visit the iconic Eiffel Tower and enjoy panoramic views',
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
              required: true,
              website: 'https://www.toureiffel.paris',
              advanceNotice: '24 hours'
            },
            accessibility: {
              wheelchairAccessible: true,
              mobilityFriendly: true
            },
            tips: ['Book tickets online to avoid queues', 'Visit during sunset for best photos'],
            alternatives: ['Arc de Triomphe', 'Montparnasse Tower']
          }
        ],
        meals: [
          {
            time: '12:30',
            type: 'lunch',
            restaurant: {
              name: 'Café de Flore',
              cuisine: 'French',
              location: 'Saint-Germain-des-Prés',
              priceRange: '$$',
              atmosphere: 'Historic literary café'
            },
            estimatedCost: {
              amount: 35,
              currency: 'USD'
            },
            reservationInfo: {
              required: false
            },
            highlights: ['Famous onion soup', 'Historic ambiance'],
            dietaryOptions: ['Vegetarian options available']
          }
        ],
        transportation: [
          {
            from: 'Charles de Gaulle Airport',
            to: 'Hotel',
            method: 'taxi',
            duration: 45,
            cost: {
              amount: 55,
              currency: 'USD'
            },
            instructions: 'Take taxi from airport to central Paris hotel',
            alternatives: ['RER B train', 'Airport shuttle']
          }
        ],
        dailyBudget: {
          estimated: 560,
          breakdown: {
            activities: 150,
            food: 120,
            transportation: 80,
            miscellaneous: 50
          }
        },
        tips: ['Carry small denominations for tips', 'Download offline maps'],
        alternatives: []
      }
    ],
    travelTips: {
      general: ['Learn basic French phrases', 'Carry cash and cards'],
      cultural: ['Greet shopkeepers when entering stores', 'Dress nicely for restaurants'],
      practical: ['Metro is efficient for getting around', 'Museums are closed on Mondays'],
      safety: ['Be aware of pickpockets in tourist areas', 'Keep copies of important documents']
    },
    emergencyInfo: {
      emergency: '112',
      police: '17',
      medical: '15',
      embassy: {
        us: '+33 1 43 12 22 22',
        uk: '+33 1 44 51 31 00'
      },
      hospitals: [
        {
          name: 'Hôpital Saint-Louis',
          phone: '+33 1 42 49 49 49',
          address: '1 Avenue Claude Vellefaux, 75010 Paris'
        }
      ]
    },
    recommendations: {
      restaurants: [
        {
          name: 'L\'As du Fallafel',
          cuisine: 'Middle Eastern',
          priceRange: '$',
          location: 'Marais district',
          specialties: ['Falafel sandwich', 'Hummus'],
          reservationRequired: false
        }
      ],
      activities: [
        {
          name: 'Seine River Cruise',
          type: 'sightseeing',
          duration: 90,
          cost: 20,
          difficulty: 'easy',
          bestTime: 'Evening',
          bookingRequired: true
        }
      ],
      shopping: [
        {
          name: 'Marché aux Puces',
          type: 'Flea market',
          location: 'Saint-Ouen',
          specialties: ['Antiques', 'Vintage items'],
          priceRange: 'Variable'
        }
      ]
    },
    localInsights: {
      culture: ['French people value politeness and formality'],
      etiquette: ['Always say "Bonjour" when entering shops'],
      language: {
        basicPhrases: {
          hello: 'Bonjour',
          thank_you: 'Merci',
          please: 'S\'il vous plaît',
          excuse_me: 'Excusez-moi'
        },
        usefulWords: {
          bathroom: 'Toilettes',
          water: 'Eau',
          help: 'Aide'
        }
      },
      transportation: {
        publicTransport: 'Metro system with 14 lines, operates 5:30 AM to 1:15 AM',
        taxiApps: ['Uber', 'G7', 'Le Cab'],
        walkingAreas: ['Latin Quarter', 'Marais', 'Montmartre']
      },
      weather: {
        general: 'Mild winters, warm summers',
        clothing: ['Comfortable walking shoes', 'Light jacket', 'Umbrella'],
        seasonalTips: ['December is festive but cold', 'Dress in layers']
      }
    },
    generationMetadata: {
      model: 'claude-3-sonnet-20240229',
      confidence: 0.85,
      tokensUsed: 3500,
      generatedAt: '2024-12-01T10:00:00Z',
      version: '1.0'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    claudeService = new ClaudeService();
  });

  describe('Itinerary Generation', () => {
    it('should generate itinerary successfully with cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: {
          input_tokens: 2000,
          output_tokens: 1500
        }
      });
      mockRedisService.setex.mockResolvedValue('OK');

      const result = await claudeService.generateItinerary(mockItineraryParams);

      expect(result).toMatchObject({
        overview: expect.objectContaining({
          title: expect.any(String),
          description: expect.any(String)
        }),
        totalBudget: expect.objectContaining({
          estimated: expect.any(Number),
          currency: 'USD'
        }),
        dailyItinerary: expect.arrayContaining([
          expect.objectContaining({
            day: expect.any(Number),
            date: expect.any(String),
            activities: expect.any(Array)
          })
        ])
      });

      expect(mockRedisService.get).toHaveBeenCalled();
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: expect.stringContaining('Paris, France')
        }]
      });
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.any(String),
        3600,
        expect.any(String)
      );
    });

    it('should return cached itinerary when available', async () => {
      const cachedItinerary = JSON.stringify(mockGeneratedItinerary);
      mockRedisService.get.mockResolvedValue(cachedItinerary);

      const result = await claudeService.generateItinerary(mockItineraryParams);

      expect(result).toEqual(mockGeneratedItinerary);
      expect(mockAnthropicClient.messages.create).not.toHaveBeenCalled();
      expect(mockRedisService.setex).not.toHaveBeenCalled();
    });

    it('should handle rate limit errors (429)', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Rate limited');
      (error as any).status = 429;
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('AI service rate limit exceeded. Please try again in a moment.');
    });

    it('should handle invalid request errors (400)', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Invalid request');
      (error as any).status = 400;
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('Invalid request parameters for itinerary generation.');
    });

    it('should handle generic API errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Service unavailable');
      (error as any).status = 500;
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('Itinerary generation service temporarily unavailable.');
    });

    it('should handle invalid response format', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'image',
          source: 'invalid'
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      await expect(claudeService.generateItinerary(mockItineraryParams))
        .rejects.toThrow('Unexpected response format from Claude API');
    });

    it('should generate fallback itinerary when parsing fails', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: 'Invalid JSON response'
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(mockItineraryParams);

      expect(result).toMatchObject({
        overview: expect.objectContaining({
          title: expect.stringContaining(mockItineraryParams.destination),
          description: expect.any(String)
        }),
        totalBudget: expect.objectContaining({
          estimated: mockItineraryParams.budget.total,
          currency: mockItineraryParams.budget.currency
        }),
        dailyItinerary: expect.arrayContaining([
          expect.objectContaining({
            day: 1,
            date: mockItineraryParams.startDate,
            location: mockItineraryParams.destination
          })
        ]),
        generationMetadata: expect.objectContaining({
          model: 'fallback',
          confidence: 0.3
        })
      });
    });

    it('should handle accessibility requirements correctly', async () => {
      const accessibilityParams = {
        ...mockItineraryParams,
        preferences: {
          ...mockItineraryParams.preferences,
          accessibility: {
            wheelchair: true,
            mobility: 'limited' as const
          }
        }
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: { input_tokens: 2000, output_tokens: 1500 }
      });

      await claudeService.generateItinerary(accessibilityParams);

      const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
      expect(promptCall.messages[0].content).toContain('Wheelchair accessible');
      expect(promptCall.messages[0].content).toContain('Limited mobility considerations');
    });

    it('should include context data in prompt when provided', async () => {
      const paramsWithContext = {
        ...mockItineraryParams,
        context: {
          selectedFlights: [{ airline: 'Air France', departure: '08:00' }],
          selectedHotels: [{ name: 'Hotel Paris', location: 'Central Paris' }],
          weatherData: { temperature: 15, conditions: 'Partly cloudy' },
          localEvents: [{ name: 'Christmas Market', date: '2024-12-25' }]
        }
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: { input_tokens: 2000, output_tokens: 1500 }
      });

      await claudeService.generateItinerary(paramsWithContext);

      const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
      expect(promptCall.messages[0].content).toContain('SELECTED FLIGHTS');
      expect(promptCall.messages[0].content).toContain('SELECTED HOTELS');
    });
  });

  describe('Itinerary Refinement', () => {
    const mockRefinementRequest = {
      type: 'modify_activity' as const,
      details: {
        day: 1,
        activityIndex: 0,
        newActivity: 'Musée d\'Orsay visit'
      },
      userFeedback: 'Want to see more impressionist art'
    };

    it('should refine itinerary successfully', async () => {
      const refinedItinerary = {
        ...mockGeneratedItinerary,
        dailyItinerary: [
          {
            ...mockGeneratedItinerary.dailyItinerary[0],
            activities: [
              {
                ...mockGeneratedItinerary.dailyItinerary[0].activities[0],
                title: 'Musée d\'Orsay Visit'
              }
            ]
          }
        ]
      };

      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(refinedItinerary)
        }],
        usage: { input_tokens: 1500, output_tokens: 1000 }
      });

      const result = await claudeService.refineItinerary(mockGeneratedItinerary, mockRefinementRequest);

      expect(result.dailyItinerary[0].activities[0].title).toBe('Musée d\'Orsay Visit');
      expect(result.generationMetadata.tokensUsed).toBeGreaterThan(mockGeneratedItinerary.generationMetadata.tokensUsed);

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4000,
        temperature: 0.5,
        messages: [{
          role: 'user',
          content: expect.stringContaining('modify_activity')
        }]
      });
    });

    it('should handle refinement errors', async () => {
      mockAnthropicClient.messages.create.mockRejectedValue(new Error('Refinement failed'));

      await expect(claudeService.refineItinerary(mockGeneratedItinerary, mockRefinementRequest))
        .rejects.toThrow('Unable to refine itinerary. Please try again.');
    });

    it('should use lower temperature for refinements', async () => {
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: { input_tokens: 1500, output_tokens: 1000 }
      });

      await claudeService.refineItinerary(mockGeneratedItinerary, mockRefinementRequest);

      const promptCall = mockAnthropicClient.messages.create.mock.calls[0][0];
      expect(promptCall.temperature).toBe(0.5);
    });
  });

  describe('Activity Suggestions', () => {
    const mockActivitySuggestions = [
      {
        time: '10:00',
        duration: 120,
        type: 'museum',
        title: 'Louvre Museum Visit',
        description: 'Explore world-famous art collections',
        location: {
          name: 'Louvre Museum',
          address: 'Rue de Rivoli, 75001 Paris'
        },
        cost: {
          amount: 17,
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
        tips: ['Book online to skip lines'],
        alternatives: ['Musée d\'Orsay']
      }
    ];

    it('should generate activity suggestions successfully', async () => {
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockActivitySuggestions)
        }],
        usage: { input_tokens: 500, output_tokens: 300 }
      });

      const result = await claudeService.generateActivitySuggestions(
        'Paris, France',
        ['museums', 'art'],
        500,
        3
      );

      expect(result).toEqual(mockActivitySuggestions);
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 2000,
        temperature: 0.8,
        messages: [{
          role: 'user',
          content: expect.stringContaining('Paris, France')
        }]
      });
    });

    it('should handle activity suggestion errors', async () => {
      mockAnthropicClient.messages.create.mockRejectedValue(new Error('Failed to generate suggestions'));

      await expect(claudeService.generateActivitySuggestions('Paris', ['museums'], 500, 3))
        .rejects.toThrow('Unable to generate activity suggestions.');
    });

    it('should return empty array when parsing fails', async () => {
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: 'Invalid JSON response'
        }],
        usage: { input_tokens: 500, output_tokens: 300 }
      });

      const result = await claudeService.generateActivitySuggestions('Paris', ['museums'], 500, 3);

      expect(result).toEqual([]);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent cache keys', () => {
      const params1 = { ...mockItineraryParams };
      const params2 = { ...mockItineraryParams };

      // Since generateCacheKey is private, we'll test it indirectly through generate calls
      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockGeneratedItinerary) }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const service1 = new ClaudeService();
      const service2 = new ClaudeService();

      service1.generateItinerary(params1);
      const firstCall = mockRedisService.get.mock.calls[0][0];

      jest.clearAllMocks();

      service2.generateItinerary(params2);
      const secondCall = mockRedisService.get.mock.calls[0][0];

      expect(firstCall).toBe(secondCall);
    });

    it('should generate different cache keys for different parameters', () => {
      const params1 = { ...mockItineraryParams };
      const params2 = { ...mockItineraryParams, duration: 7 };

      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockGeneratedItinerary) }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      claudeService.generateItinerary(params1);
      const firstCall = mockRedisService.get.mock.calls[0][0];

      jest.clearAllMocks();

      claudeService.generateItinerary(params2);
      const secondCall = mockRedisService.get.mock.calls[0][0];

      expect(firstCall).not.toBe(secondCall);
    });
  });

  describe('Confidence Calculation', () => {
    it('should calculate confidence based on completeness', async () => {
      const incompleteItinerary = {
        ...mockGeneratedItinerary,
        dailyItinerary: [
          {
            ...mockGeneratedItinerary.dailyItinerary[0],
            activities: [], // No activities
            meals: [] // No meals
          }
        ],
        travelTips: {
          general: [], // No tips
          cultural: [],
          practical: [],
          safety: []
        }
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(incompleteItinerary)
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(mockItineraryParams);

      // Confidence should be lower for incomplete itinerary
      expect(result.generationMetadata.confidence).toBeLessThan(0.8);
    });

    it('should adjust confidence based on budget alignment', async () => {
      const offBudgetItinerary = {
        ...mockGeneratedItinerary,
        totalBudget: {
          ...mockGeneratedItinerary.totalBudget,
          estimated: 5000 // Much higher than requested 3000
        }
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(offBudgetItinerary)
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(mockItineraryParams);

      // Confidence should be lower when budget is significantly off
      expect(result.generationMetadata.confidence).toBeLessThan(0.8);
    });
  });

  describe('Health Check', () => {
    it('should return true when service is healthy', async () => {
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello!' }],
        usage: { input_tokens: 5, output_tokens: 5 }
      });

      const result = await claudeService.healthCheck();

      expect(result).toBe(true);
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 10,
        messages: [{
          role: 'user',
          content: 'Hello'
        }]
      });
    });

    it('should return false when service is unhealthy', async () => {
      mockAnthropicClient.messages.create.mockRejectedValue(new Error('Service down'));

      const result = await claudeService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle redis cache errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(mockItineraryParams);

      // Should still work even if cache fails
      expect(result).toBeDefined();
      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
    });

    it('should handle cache set errors gracefully', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRedisService.setex.mockRejectedValue(new Error('Cache set failed'));
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(mockItineraryParams);

      // Should still return result even if caching fails
      expect(result).toBeDefined();
    });

    it('should handle malformed JSON in response', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: '{ malformed: json response'
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(mockItineraryParams);

      // Should return fallback itinerary
      expect(result.generationMetadata.model).toBe('fallback');
      expect(result.generationMetadata.confidence).toBe(0.3);
    });

    it('should handle empty activity suggestions response', async () => {
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: 'No activities found'
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateActivitySuggestions('Unknown', ['none'], 0, 1);

      expect(result).toEqual([]);
    });

    it('should handle special characters in destination names', async () => {
      const specialParams = {
        ...mockItineraryParams,
        destination: 'São Paulo, Brazil'
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAnthropicClient.messages.create.mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify(mockGeneratedItinerary)
        }],
        usage: { input_tokens: 100, output_tokens: 100 }
      });

      const result = await claudeService.generateItinerary(specialParams);

      expect(result).toBeDefined();
      // Should handle special characters in cache key generation
      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringMatching(/s_o_paulo/)
      );
    });
  });
});