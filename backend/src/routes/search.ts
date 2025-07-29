import { Router, Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { AmadeusService } from '../services/external/amadeusService.js';
import { FirebaseService } from '../services/external/firebaseService.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimiter.js';

const router = Router();
const amadeusService = new AmadeusService();
const firebaseService = new FirebaseService();

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Search flights endpoint
router.post('/flights',
  rateLimiter({ windowMs: 60 * 1000, max: 20 }), // 20 requests per minute
  [
    body('originLocationCode').isLength({ min: 3, max: 3 }).isAlpha(),
    body('destinationLocationCode').isLength({ min: 3, max: 3 }).isAlpha(),
    body('departureDate').isISO8601().toDate(),
    body('returnDate').optional().isISO8601().toDate(),
    body('adults').isInt({ min: 1, max: 9 }),
    body('children').optional().isInt({ min: 0, max: 9 }),
    body('infants').optional().isInt({ min: 0, max: 9 }),
    body('travelClass').optional().isIn(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']),
    body('nonStop').optional().isBoolean(),
    body('maxPrice').optional().isFloat({ min: 0 }),
    body('max').optional().isInt({ min: 1, max: 250 }),
    body('currencyCode').optional().isLength({ min: 3, max: 3 }).isAlpha(),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const searchParams = {
      originLocationCode: req.body.originLocationCode,
      destinationLocationCode: req.body.destinationLocationCode,
      departureDate: req.body.departureDate,
      returnDate: req.body.returnDate,
      adults: req.body.adults,
      children: req.body.children || 0,
      infants: req.body.infants || 0,
      travelClass: req.body.travelClass || 'ECONOMY',
      nonStop: req.body.nonStop || false,
      maxPrice: req.body.maxPrice,
      max: req.body.max || 50,
      currencyCode: req.body.currencyCode || 'USD',
    };

    try {
      const searchResult = await amadeusService.searchFlights(searchParams);

      // Save search history
      await firebaseService.saveSearchHistory({
        userId: req.user.uid,
        type: 'flight',
        query: searchParams,
        results: { count: searchResult.data.length },
        timestamp: new Date().toISOString()
      });

      logger.info('Flight search completed', {
        userId: req.user.uid,
        origin: searchParams.originLocationCode,
        destination: searchParams.destinationLocationCode,
        resultCount: searchResult.data.length,
        requestId: req.id
      });

      res.status(200).json({
        success: true,
        data: {
          searchId: `search_${Date.now()}`,
          flights: searchResult.data,
          meta: searchResult.meta,
          dictionaries: searchResult.dictionaries,
          searchParams
        },
        message: 'Flight search completed successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Flight search failed', {
        error: error.message,
        userId: req.user.uid,
        searchParams,
        requestId: req.id
      });

      if (error.message.includes('Rate limit exceeded')) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'API_002',
            message: 'Rate limit exceeded',
            details: { reason: 'Too many search requests. Please try again later.' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (error.message.includes('Invalid search parameters')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'SEARCH_002',
            message: 'Invalid search parameters',
            details: { reason: error.message }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (error.message.includes('No flights found')) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'SEARCH_001',
            message: 'No flights found',
            details: { reason: 'No flights available for the specified criteria' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      res.status(503).json({
        success: false,
        error: {
          code: 'API_001',
          message: 'Search service temporarily unavailable',
          details: { reason: 'Flight search service is currently unavailable' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Search hotels endpoint
router.post('/hotels',
  rateLimiter({ windowMs: 60 * 1000, max: 20 }), // 20 requests per minute
  [
    body('cityCode').isLength({ min: 3, max: 3 }).isAlpha(),
    body('checkInDate').isISO8601().toDate(),
    body('checkOutDate').isISO8601().toDate(),
    body('roomQuantity').optional().isInt({ min: 1, max: 9 }),
    body('adults').optional().isInt({ min: 1, max: 9 }),
    body('radius').optional().isInt({ min: 1, max: 300 }),
    body('radiusUnit').optional().isIn(['KM', 'MILE']),
    body('ratings').optional().isArray(),
    body('priceRange').optional().isString(),
    body('currency').optional().isLength({ min: 3, max: 3 }).isAlpha(),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    // Validate check-in is before check-out
    if (new Date(req.body.checkInDate) >= new Date(req.body.checkOutDate)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid date range',
          details: { reason: 'Check-in date must be before check-out date' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const searchParams = {
      cityCode: req.body.cityCode,
      checkInDate: req.body.checkInDate,
      checkOutDate: req.body.checkOutDate,
      roomQuantity: req.body.roomQuantity || 1,
      adults: req.body.adults || 1,
      radius: req.body.radius,
      radiusUnit: req.body.radiusUnit,
      ratings: req.body.ratings,
      priceRange: req.body.priceRange,
      currency: req.body.currency || 'USD',
    };

    try {
      const searchResult = await amadeusService.searchHotels(searchParams);

      // Save search history
      await firebaseService.saveSearchHistory({
        userId: req.user.uid,
        type: 'hotel',
        query: searchParams,
        results: { count: searchResult.data.length },
        timestamp: new Date().toISOString()
      });

      logger.info('Hotel search completed', {
        userId: req.user.uid,
        cityCode: searchParams.cityCode,
        resultCount: searchResult.data.length,
        requestId: req.id
      });

      res.status(200).json({
        success: true,
        data: {
          searchId: `hotel_search_${Date.now()}`,
          hotels: searchResult.data,
          meta: searchResult.meta,
          searchParams
        },
        message: 'Hotel search completed successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Hotel search failed', {
        error: error.message,
        userId: req.user.uid,
        searchParams,
        requestId: req.id
      });

      if (error.message.includes('Rate limit exceeded')) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'API_002',
            message: 'Rate limit exceeded',
            details: { reason: 'Too many search requests. Please try again later.' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      if (error.message.includes('No hotels found')) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'SEARCH_001',
            message: 'No hotels found',
            details: { reason: 'No hotels available for the specified criteria' }
          },
          timestamp: new Date().toISOString(),
          requestId: req.id
        });
      }

      res.status(503).json({
        success: false,
        error: {
          code: 'API_001',
          message: 'Search service temporarily unavailable',
          details: { reason: 'Hotel search service is currently unavailable' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

// Search locations endpoint (for autocomplete)
router.get('/locations',
  rateLimiter({ windowMs: 60 * 1000, max: 100 }), // 100 requests per minute
  [
    query('q').isLength({ min: 2, max: 50 }),
    query('type').optional().isIn(['city', 'airport', 'all']),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  asyncHandler(async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid search parameters',
          details: errors.array()
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }

    const { q: keyword, type = 'all', limit = 10 } = req.query;

    try {
      let results = [];

      if (type === 'airport' || type === 'all') {
        const airports = await amadeusService.searchAirports(keyword as string);
        results.push(...airports.map((airport: any) => ({
          id: `airport_${airport.iataCode}`,
          name: airport.name,
          iataCode: airport.iataCode,
          type: 'airport',
          city: airport.address?.cityName,
          country: airport.address?.countryName,
          coordinates: {
            latitude: airport.geoCode?.latitude,
            longitude: airport.geoCode?.longitude
          }
        })));
      }

      if (type === 'city' || type === 'all') {
        const cities = await amadeusService.searchCities(keyword as string);
        results.push(...cities.map((city: any) => ({
          id: `city_${city.iataCode}`,
          name: city.name,
          iataCode: city.iataCode,
          type: 'city',
          country: city.address?.countryName,
          coordinates: {
            latitude: city.geoCode?.latitude,
            longitude: city.geoCode?.longitude
          }
        })));
      }

      // Limit results
      results = results.slice(0, parseInt(limit as string));

      res.status(200).json({
        success: true,
        data: results,
        message: 'Location search completed successfully',
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    } catch (error: any) {
      logger.error('Location search failed', {
        error: error.message,
        keyword,
        type,
        requestId: req.id
      });

      res.status(503).json({
        success: false,
        error: {
          code: 'API_001',
          message: 'Location search service temporarily unavailable',
          details: { reason: 'Location search service is currently unavailable' }
        },
        timestamp: new Date().toISOString(),
        requestId: req.id
      });
    }
  })
);

export default router;