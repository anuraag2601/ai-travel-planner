import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import itinerariesRouter from '../../routes/itineraries.js';

// Mock dependencies
const mockClaudeService = {
  generateItinerary: jest.fn(),
};

const mockFirebaseService = {
  saveItinerary: jest.fn(),
  getItinerary: jest.fn(),
  getUserItineraries: jest.fn(),
  updateItinerary: jest.fn(),
  deleteItinerary: jest.fn(),
  saveSearchHistory: jest.fn(),
};

jest.mock('../../services/external/claudeService.js', () => ({
  ClaudeService: jest.fn(() => mockClaudeService)
}));

jest.mock('../../services/external/firebaseService.js', () => ({
  FirebaseService: jest.fn(() => mockFirebaseService)
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
    req.user = { uid: 'test-user-123' };
    next();
  }
}));

// Create test app
const app = express();
app.use(express.json());
app.use((req: any, res: any, next: any) => {
  req.id = 'test-request-id';
  next();
});
app.use('/itineraries', itinerariesRouter);

describe('Itineraries API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /itineraries/generate', () => {
    const validItineraryData = {
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
        mustVisit: ['Eiffel Tower', 'Louvre Museum'],
        budgetConstraints: {
          maxMealCost: 100,
          maxActivityCost: 50
        }
      }
    };

    const mockGeneratedItinerary = {
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

    it('should generate itinerary successfully', async () => {
      mockClaudeService.generateItinerary.mockResolvedValue(mockGeneratedItinerary);
      mockFirebaseService.saveItinerary.mockResolvedValue('itinerary123');
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/itineraries/generate')
        .send(validItineraryData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.itineraryId).toBe('itinerary123');
      expect(response.body.data.overview.title).toBe('7-Day Cultural Paris Adventure');
      expect(response.body.message).toBe('Itinerary generated successfully');

      expect(mockClaudeService.generateItinerary).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: 'Paris',
          duration: 7,
          travelers: { adults: 2, children: 1 }
        })
      );

      expect(mockFirebaseService.saveItinerary).toHaveBeenCalledWith({
        userId: 'test-user-123',
        title: '7-Day Cultural Paris Adventure',
        destination: 'Paris',
        startDate: '2024-03-15',
        endDate: '2024-03-21',
        duration: 7,
        status: 'completed',
        data: mockGeneratedItinerary
      });

      expect(mockFirebaseService.saveSearchHistory).toHaveBeenCalledWith({
        userId: 'test-user-123',
        type: 'itinerary',
        query: expect.objectContaining({
          destination: 'Paris',
          duration: 7
        }),
        results: { itineraryId: 'itinerary123' },
        timestamp: expect.any(String)
      });
    });

    it('should return validation error for missing required fields', async () => {
      const invalidData = {
        destination: 'Paris'
        // Missing other required fields
      };

      const response = await request(app)
        .post('/itineraries/generate')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid itinerary parameters');
    });

    it('should return validation error for invalid date range', async () => {
      const invalidData = {
        ...validItineraryData,
        duration: 5, // Duration doesn't match date range
        startDate: '2024-03-15',
        endDate: '2024-03-21' // This is 7 days, not 5
      };

      const response = await request(app)
        .post('/itineraries/generate')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid date range');
    });

    it('should return validation error for invalid duration', async () => {
      const invalidData = {
        ...validItineraryData,
        duration: 0
      };

      const response = await request(app)
        .post('/itineraries/generate')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for invalid travelers count', async () => {
      const invalidData = {
        ...validItineraryData,
        travelers: {
          adults: 0, // Must be at least 1
          children: 1
        }
      };

      const response = await request(app)
        .post('/itineraries/generate')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle rate limit errors', async () => {
      mockClaudeService.generateItinerary.mockRejectedValue(
        new Error('AI service rate limit exceeded. Please try again in a moment.')
      );

      const response = await request(app)
        .post('/itineraries/generate')
        .send(validItineraryData);

      expect(response.status).toBe(429);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('API_002');
      expect(response.body.error.message).toBe('AI service rate limit exceeded');
    });

    it('should handle invalid generation parameters', async () => {
      mockClaudeService.generateItinerary.mockRejectedValue(
        new Error('Invalid request parameters for itinerary generation.')
      );

      const response = await request(app)
        .post('/itineraries/generate')
        .send(validItineraryData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_002');
      expect(response.body.error.message).toBe('Invalid generation parameters');
    });

    it('should handle service unavailable errors', async () => {
      mockClaudeService.generateItinerary.mockRejectedValue(
        new Error('Itinerary generation service temporarily unavailable.')
      );

      const response = await request(app)
        .post('/itineraries/generate')
        .send(validItineraryData);

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_001');
      expect(response.body.error.message).toBe('Itinerary generation failed');
    });

    it('should handle budget categories defaulting', async () => {
      const dataWithoutBudgetCategories = {
        ...validItineraryData,
        budget: {
          total: 5000,
          currency: 'USD'
          // categories omitted
        }
      };

      mockClaudeService.generateItinerary.mockResolvedValue(mockGeneratedItinerary);
      mockFirebaseService.saveItinerary.mockResolvedValue('itinerary123');
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/itineraries/generate')
        .send(dataWithoutBudgetCategories);

      expect(response.status).toBe(200);
      expect(mockClaudeService.generateItinerary).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({
            categories: {
              accommodation: 2000, // 40% of 5000
              activities: 1500,    // 30% of 5000
              food: 1000,          // 20% of 5000
              transportation: 500   // 10% of 5000
            }
          })
        })
      );
    });
  });

  describe('GET /itineraries/:id', () => {
    const mockItinerary = {
      id: 'itinerary123',
      userId: 'test-user-123',
      title: 'Paris Adventure',
      destination: 'Paris',
      startDate: '2024-03-15',
      endDate: '2024-03-21',
      duration: 7,
      status: 'completed',
      data: mockGeneratedItinerary,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      version: 1
    };

    it('should get itinerary successfully', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(mockItinerary);

      const response = await request(app)
        .get('/itineraries/itinerary123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('itinerary123');
      expect(response.body.data.title).toBe('Paris Adventure');
      expect(response.body.message).toBe('Itinerary retrieved successfully');

      expect(mockFirebaseService.getItinerary).toHaveBeenCalledWith('itinerary123');
    });

    it('should return 404 for non-existent itinerary', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(null);

      const response = await request(app)
        .get('/itineraries/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_003');
      expect(response.body.error.message).toBe('Itinerary not found');
    });

    it('should return 403 for unauthorized access', async () => {
      const unauthorizedItinerary = {
        ...mockItinerary,
        userId: 'other-user-456' // Different user
      };

      mockFirebaseService.getItinerary.mockResolvedValue(unauthorizedItinerary);

      const response = await request(app)
        .get('/itineraries/itinerary123');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_004');
      expect(response.body.error.message).toBe('Access denied');
    });

    it('should allow access to shared itinerary', async () => {
      const sharedItinerary = {
        ...mockItinerary,
        userId: 'other-user-456',
        sharedWith: ['test-user-123'] // Current user is in shared list
      };

      mockFirebaseService.getItinerary.mockResolvedValue(sharedItinerary);

      const response = await request(app)
        .get('/itineraries/itinerary123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('itinerary123');
    });

    it('should handle service errors', async () => {
      mockFirebaseService.getItinerary.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/itineraries/itinerary123');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_005');
      expect(response.body.error.message).toBe('Failed to retrieve itinerary');
    });
  });

  describe('PUT /itineraries/:id', () => {
    const mockItinerary = {
      id: 'itinerary123',
      userId: 'test-user-123',
      title: 'Original Title',
      status: 'draft'
    };

    it('should update itinerary successfully', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(mockItinerary);
      mockFirebaseService.updateItinerary.mockResolvedValue(undefined);

      const updateData = {
        title: 'Updated Paris Adventure',
        status: 'completed'
      };

      const response = await request(app)
        .put('/itineraries/itinerary123')
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.itineraryId).toBe('itinerary123');
      expect(response.body.data.updatedFields).toContain('title');
      expect(response.body.data.updatedFields).toContain('status');
      expect(response.body.message).toBe('Itinerary updated successfully');

      expect(mockFirebaseService.updateItinerary).toHaveBeenCalledWith(
        'itinerary123',
        updateData
      );
    });

    it('should return 404 for non-existent itinerary', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(null);

      const response = await request(app)
        .put('/itineraries/nonexistent')
        .send({ title: 'New Title' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_003');
    });

    it('should return 403 for unauthorized update', async () => {
      const unauthorizedItinerary = {
        ...mockItinerary,
        userId: 'other-user-456'
      };

      mockFirebaseService.getItinerary.mockResolvedValue(unauthorizedItinerary);

      const response = await request(app)
        .put('/itineraries/itinerary123')
        .send({ title: 'New Title' });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_002');
      expect(response.body.error.message).toBe('Update not allowed');
    });

    it('should validate update data', async () => {
      const response = await request(app)
        .put('/itineraries/itinerary123')
        .send({
          status: 'invalid-status' // Invalid status value
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle service errors', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(mockItinerary);
      mockFirebaseService.updateItinerary.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .put('/itineraries/itinerary123')
        .send({ title: 'New Title' });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_005');
    });
  });

  describe('GET /itineraries', () => {
    const mockItineraries = [
      {
        id: 'itinerary1',
        userId: 'test-user-123',
        title: 'Paris Trip',
        status: 'completed',
        updatedAt: '2024-01-15T12:00:00Z'
      },
      {
        id: 'itinerary2',
        userId: 'test-user-123',
        title: 'London Trip',
        status: 'draft',
        updatedAt: '2024-01-14T12:00:00Z'
      }
    ];

    it('should get user itineraries successfully', async () => {
      mockFirebaseService.getUserItineraries.mockResolvedValue(mockItineraries);

      const response = await request(app)
        .get('/itineraries');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.itineraries).toHaveLength(2);
      expect(response.body.data.itineraries[0].id).toBe('itinerary1');
      expect(response.body.message).toBe('Itineraries retrieved successfully');

      expect(mockFirebaseService.getUserItineraries).toHaveBeenCalledWith(
        'test-user-123',
        20,
        undefined
      );
    });

    it('should handle limit parameter', async () => {
      mockFirebaseService.getUserItineraries.mockResolvedValue([mockItineraries[0]]);

      const response = await request(app)
        .get('/itineraries')
        .query({ limit: 1 });

      expect(response.status).toBe(200);
      expect(response.body.data.itineraries).toHaveLength(1);

      expect(mockFirebaseService.getUserItineraries).toHaveBeenCalledWith(
        'test-user-123',
        1,
        undefined
      );
    });

    it('should handle startAfter parameter', async () => {
      mockFirebaseService.getUserItineraries.mockResolvedValue([mockItineraries[1]]);

      const response = await request(app)
        .get('/itineraries')
        .query({ startAfter: 'itinerary1' });

      expect(response.status).toBe(200);

      expect(mockFirebaseService.getUserItineraries).toHaveBeenCalledWith(
        'test-user-123',
        20,
        'itinerary1'
      );
    });

    it('should filter by status', async () => {
      const completedItineraries = mockItineraries.filter(i => i.status === 'completed');
      mockFirebaseService.getUserItineraries.mockResolvedValue(mockItineraries);

      const response = await request(app)
        .get('/itineraries')
        .query({ status: 'completed' });

      expect(response.status).toBe(200);
      expect(response.body.data.itineraries).toHaveLength(1);
      expect(response.body.data.itineraries[0].status).toBe('completed');
    });

    it('should validate query parameters', async () => {
      const response = await request(app)
        .get('/itineraries')
        .query({ limit: 0 }); // Invalid limit

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle service errors', async () => {
      mockFirebaseService.getUserItineraries.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/itineraries');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_005');
    });
  });

  describe('DELETE /itineraries/:id', () => {
    const mockItinerary = {
      id: 'itinerary123',
      userId: 'test-user-123',
      title: 'Paris Adventure'
    };

    it('should delete itinerary successfully', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(mockItinerary);
      mockFirebaseService.deleteItinerary.mockResolvedValue(undefined);

      const response = await request(app)
        .delete('/itineraries/itinerary123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.itineraryId).toBe('itinerary123');
      expect(response.body.message).toBe('Itinerary deleted successfully');

      expect(mockFirebaseService.deleteItinerary).toHaveBeenCalledWith('itinerary123');
    });

    it('should return 404 for non-existent itinerary', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(null);

      const response = await request(app)
        .delete('/itineraries/nonexistent');

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_003');
    });

    it('should return 403 for unauthorized deletion', async () => {
      const unauthorizedItinerary = {
        ...mockItinerary,
        userId: 'other-user-456'
      };

      mockFirebaseService.getItinerary.mockResolvedValue(unauthorizedItinerary);

      const response = await request(app)
        .delete('/itineraries/itinerary123');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_002');
      expect(response.body.error.message).toBe('Delete not allowed');
    });

    it('should handle service errors', async () => {
      mockFirebaseService.getItinerary.mockResolvedValue(mockItinerary);
      mockFirebaseService.deleteItinerary.mockRejectedValue(new Error('Delete failed'));

      const response = await request(app)
        .delete('/itineraries/itinerary123');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ITINERARY_005');
    });
  });

  describe('Response Format Consistency', () => {
    it('should have consistent success response format', async () => {
      mockFirebaseService.getUserItineraries.mockResolvedValue([]);

      const response = await request(app)
        .get('/itineraries');

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
    });

    it('should have consistent error response format', async () => {
      const response = await request(app)
        .post('/itineraries/generate')
        .send({ destination: 'Paris' }); // Missing required fields

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('details');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
    });
  });
});