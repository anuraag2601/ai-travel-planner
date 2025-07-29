import { Router, Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { ClaudeService } from '../services/external/claudeService.js';
import { FirebaseService } from '../services/external/firebaseService.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const claudeService = new ClaudeService();
const firebaseService = new FirebaseService();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Generate itinerary endpoint
router.post('/generate',
  rateLimiter({ windowMs: 60 * 1000, max: 5 }), // 5 requests per minute (AI generation is expensive)
  [
    body('destination').isLength({ min: 2, max: 100 }).trim(),
    body('duration').isInt({ min: 1, max: 30 }),
    body('startDate').isISO8601().toDate(),
    body('endDate').isISO8601().toDate(),
    body('travelers.adults').isInt({ min: 1, max: 20 }),
    body('travelers.children').optional().isInt({ min: 0, max: 20 }),
    body('budget.total').isFloat({ min: 100 }),
    body('budget.currency').isLength({ min: 3, max: 3 }).isAlpha(),
    body('preferences.interests').isArray({ min: 1 }),
    body('preferences.pace').isIn(['relaxed', 'moderate', 'fast']),
    body('preferences.accommodationType').isLength({ min: 1 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid itinerary parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    // Validate date range
    const startDate = new Date(req.body.startDate);
    const endDate = new Date(req.body.endDate);
    const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (duration !== req.body.duration || duration <= 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid date range',
          details: { reason: 'Duration must match the difference between start and end dates' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const itineraryParams = {
      destination: req.body.destination,
      duration: req.body.duration,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      travelers: {
        adults: req.body.travelers.adults,
        children: req.body.travelers.children || 0
      },
      budget: {
        total: req.body.budget.total,
        currency: req.body.budget.currency,
        categories: req.body.budget.categories || {
          accommodation: Math.floor(req.body.budget.total * 0.4),
          activities: Math.floor(req.body.budget.total * 0.3),
          food: Math.floor(req.body.budget.total * 0.2),
          transportation: Math.floor(req.body.budget.total * 0.1)
        }
      },
      preferences: {
        interests: req.body.preferences.interests,
        pace: req.body.preferences.pace,
        accommodationType: req.body.preferences.accommodationType,
        diningPreferences: req.body.preferences.diningPreferences || [],
        activityTypes: req.body.preferences.activityTypes || [],
        accessibility: req.body.preferences.accessibility || {
          wheelchair: false,
          mobility: 'full'
        }
      },
      constraints: {
        avoidAreas: req.body.constraints?.avoidAreas || [],
        mustVisit: req.body.constraints?.mustVisit || [],
        budgetConstraints: req.body.constraints?.budgetConstraints || {
          maxMealCost: Math.floor(req.body.budget.total * 0.05),
          maxActivityCost: Math.floor(req.body.budget.total * 0.1)
        }
      },
      context: req.body.context
    };

    try {
      const generatedItinerary = await claudeService.generateItinerary(itineraryParams);

      // Save itinerary to database
      const itineraryId = await firebaseService.saveItinerary({
        userId: req.user.uid,
        title: generatedItinerary.overview.title,
        destination: itineraryParams.destination,
        startDate: itineraryParams.startDate,
        endDate: itineraryParams.endDate,
        duration: itineraryParams.duration,
        status: 'completed',
        data: generatedItinerary
      });

      // Save search history
      await firebaseService.saveSearchHistory({
        userId: req.user.uid,
        type: 'itinerary',
        query: itineraryParams,
        results: { itineraryId },
        timestamp: new Date().toISOString()
      });

      logger.info('Itinerary generated successfully', {
        userId: req.user.uid,
        itineraryId,
        destination: itineraryParams.destination,
        duration: itineraryParams.duration,
        tokensUsed: generatedItinerary.generationMetadata.tokensUsed,
        requestId: req.id
      });

      res.status(200).json({
        success: true,
        data: {
          itineraryId,
          ...generatedItinerary
        },
        message: 'Itinerary generated successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Itinerary generation failed', {
        error: error.message,
        userId: req.user.uid,
        destination: itineraryParams.destination,
        requestId: req.id
      });

      if (error.message.includes('rate limit exceeded')) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'API_002',
            message: 'AI service rate limit exceeded',
            details: { reason: 'Too many generation requests. Please try again in a moment.' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (error.message.includes('Invalid request parameters')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'ITINERARY_002',
            message: 'Invalid generation parameters',
            details: { reason: error.message }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      res.status(503).json({
        success: false,
        error: {
          code: 'ITINERARY_001',
          message: 'Itinerary generation failed',
          details: { reason: 'AI service is temporarily unavailable' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Get itinerary by ID
router.get('/:id',
  rateLimiter({ windowMs: 60 * 1000, max: 100 }), // 100 requests per minute
  [
    param('id').isLength({ min: 1 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid itinerary ID',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    try {
      const itinerary = await firebaseService.getItinerary(req.params.id);

      if (!itinerary) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'ITINERARY_003',
            message: 'Itinerary not found',
            details: { reason: 'The requested itinerary does not exist' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      // Check if user has access to this itinerary
      if (itinerary.userId !== req.user.uid && !itinerary.sharedWith?.includes(req.user.uid)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ITINERARY_004',
            message: 'Access denied',
            details: { reason: 'You do not have permission to access this itinerary' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      res.status(200).json({
        success: true,
        data: itinerary,
        message: 'Itinerary retrieved successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Failed to retrieve itinerary', {
        error: error.message,
        itineraryId: req.params.id,
        userId: req.user.uid,
        requestId: req.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'ITINERARY_005',
          message: 'Failed to retrieve itinerary',
          details: { reason: 'Internal server error' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Update itinerary
router.put('/:id',
  rateLimiter({ windowMs: 60 * 1000, max: 20 }), // 20 requests per minute
  [
    param('id').isLength({ min: 1 }),
    body('title').optional().isLength({ min: 1, max: 200 }).trim(),
    body('status').optional().isIn(['draft', 'completed', 'shared']),
    body('data').optional().isObject(),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid update parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    try {
      const existingItinerary = await firebaseService.getItinerary(req.params.id);

      if (!existingItinerary) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'ITINERARY_003',
            message: 'Itinerary not found',
            details: { reason: 'The requested itinerary does not exist' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      // Check if user owns this itinerary
      if (existingItinerary.userId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ITINERARY_002',
            message: 'Update not allowed',
            details: { reason: 'You can only update your own itineraries' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      const updates: any = {};
      if (req.body.title) updates.title = req.body.title;
      if (req.body.status) updates.status = req.body.status;
      if (req.body.data) updates.data = req.body.data;

      await firebaseService.updateItinerary(req.params.id, updates);

      logger.info('Itinerary updated successfully', {
        userId: req.user.uid,
        itineraryId: req.params.id,
        updates: Object.keys(updates),
        requestId: req.id
      });

      res.status(200).json({
        success: true,
        data: {
          itineraryId: req.params.id,
          updatedFields: Object.keys(updates),
          updatedAt: new Date().toISOString()
        },
        message: 'Itinerary updated successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Failed to update itinerary', {
        error: error.message,
        itineraryId: req.params.id,
        userId: req.user.uid,
        requestId: req.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'ITINERARY_005',
          message: 'Failed to update itinerary',
          details: { reason: 'Internal server error' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Get user's itineraries
router.get('/',
  rateLimiter({ windowMs: 60 * 1000, max: 50 }), // 50 requests per minute
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('startAfter').optional().isString(),
    query('status').optional().isIn(['draft', 'completed', 'shared']),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const startAfter = req.query.startAfter as string | undefined;

      const itineraries = await firebaseService.getUserItineraries(
        req.user.uid,
        limit,
        startAfter
      );

      // Filter by status if specified
      let filteredItineraries = itineraries;
      if (req.query.status) {
        filteredItineraries = itineraries.filter(itinerary => 
          itinerary.status === req.query.status
        );
      }

      res.status(200).json({
        success: true,
        data: {
          itineraries: filteredItineraries,
          hasMore: itineraries.length === limit,
          nextStartAfter: itineraries.length > 0 ? itineraries[itineraries.length - 1].id : null
        },
        message: 'Itineraries retrieved successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Failed to retrieve user itineraries', {
        error: error.message,
        userId: req.user.uid,
        requestId: req.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'ITINERARY_005',
          message: 'Failed to retrieve itineraries',
          details: { reason: 'Internal server error' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Delete itinerary
router.delete('/:id',
  rateLimiter({ windowMs: 60 * 1000, max: 10 }), // 10 requests per minute
  [
    param('id').isLength({ min: 1 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid itinerary ID',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    try {
      const existingItinerary = await firebaseService.getItinerary(req.params.id);

      if (!existingItinerary) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'ITINERARY_003',
            message: 'Itinerary not found',
            details: { reason: 'The requested itinerary does not exist' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      // Check if user owns this itinerary
      if (existingItinerary.userId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ITINERARY_002',
            message: 'Delete not allowed',
            details: { reason: 'You can only delete your own itineraries' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      await firebaseService.deleteItinerary(req.params.id);

      logger.info('Itinerary deleted successfully', {
        userId: req.user.uid,
        itineraryId: req.params.id,
        requestId: req.id
      });

      res.status(200).json({
        success: true,
        data: {
          itineraryId: req.params.id,
          deletedAt: new Date().toISOString()
        },
        message: 'Itinerary deleted successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Failed to delete itinerary', {
        error: error.message,
        itineraryId: req.params.id,
        userId: req.user.uid,
        requestId: req.id
      });

      res.status(500).json({
        success: false,
        error: {
          code: 'ITINERARY_005',
          message: 'Failed to delete itinerary',
          details: { reason: 'Internal server error' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

export default router;