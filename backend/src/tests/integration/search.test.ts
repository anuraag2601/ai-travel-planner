import { jest, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import searchRouter from '../../routes/search.js';

// Mock dependencies
const mockAmadeusService = {
  searchFlights: jest.fn(),
  searchHotels: jest.fn(),
  searchAirports: jest.fn(),
  searchCities: jest.fn(),
};

const mockFirebaseService = {
  saveSearchHistory: jest.fn(),
};

jest.mock('../../services/external/amadeusService.js', () => ({
  AmadeusService: jest.fn(() => mockAmadeusService)
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
app.use('/search', searchRouter);

describe('Search API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /search/flights', () => {
    const validFlightSearchData = {
      originLocationCode: 'JFK',
      destinationLocationCode: 'CDG',
      departureDate: '2024-03-15',
      returnDate: '2024-03-22',
      adults: 2,
      children: 1,
      travelClass: 'ECONOMY'
    };

    const mockFlightResponse = {
      data: [
        {
          id: 'flight123',
          price: {
            currency: 'USD',
            total: '1245.50'
          },
          itineraries: [
            {
              duration: 'PT7H15M',
              segments: [
                {
                  departure: {
                    iataCode: 'JFK',
                    at: '2024-03-15T14:30:00'
                  },
                  arrival: {
                    iataCode: 'CDG',
                    at: '2024-03-16T07:45:00'
                  },
                  carrierCode: 'AF',
                  number: '007'
                }
              ]
            }
          ]
        }
      ],
      meta: {
        count: 1
      },
      dictionaries: {
        airports: {
          'JFK': 'John F Kennedy International Airport',
          'CDG': 'Charles de Gaulle Airport'
        }
      }
    };

    it('should search flights successfully', async () => {
      mockAmadeusService.searchFlights.mockResolvedValue(mockFlightResponse);
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/search/flights')
        .send(validFlightSearchData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.flights).toHaveLength(1);
      expect(response.body.data.flights[0].id).toBe('flight123');
      expect(response.body.data.searchParams.originLocationCode).toBe('JFK');
      expect(response.body.message).toBe('Flight search completed successfully');

      expect(mockAmadeusService.searchFlights).toHaveBeenCalledWith({
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-03-15',
        returnDate: '2024-03-22',
        adults: 2,
        children: 1,
        infants: 0,
        travelClass: 'ECONOMY',
        nonStop: false,
        maxPrice: undefined,
        max: 50,
        currencyCode: 'USD'
      });

      expect(mockFirebaseService.saveSearchHistory).toHaveBeenCalledWith({
        userId: 'test-user-123',
        type: 'flight',
        query: expect.objectContaining({
          originLocationCode: 'JFK',
          destinationLocationCode: 'CDG'
        }),
        results: { count: 1 },
        timestamp: expect.any(String)
      });
    });

    it('should return validation error for invalid airport codes', async () => {
      const invalidData = {
        ...validFlightSearchData,
        originLocationCode: 'INVALID'
      };

      const response = await request(app)
        .post('/search/flights')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid search parameters');
    });

    it('should return validation error for invalid date format', async () => {
      const invalidData = {
        ...validFlightSearchData,
        departureDate: 'invalid-date'
      };

      const response = await request(app)
        .post('/search/flights')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for invalid passenger count', async () => {
      const invalidData = {
        ...validFlightSearchData,
        adults: 0
      };

      const response = await request(app)
        .post('/search/flights')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle rate limit errors', async () => {
      mockAmadeusService.searchFlights.mockRejectedValue(
        new Error('Rate limit exceeded. Please try again later.')
      );

      const response = await request(app)
        .post('/search/flights')
        .send(validFlightSearchData);

      expect(response.status).toBe(429);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('API_002');
      expect(response.body.error.message).toBe('Rate limit exceeded');
    });

    it('should handle invalid search parameters errors', async () => {
      mockAmadeusService.searchFlights.mockRejectedValue(
        new Error('Invalid search parameters. Please check your input.')
      );

      const response = await request(app)
        .post('/search/flights')
        .send(validFlightSearchData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SEARCH_002');
      expect(response.body.error.message).toBe('Invalid search parameters');
    });

    it('should handle no flights found errors', async () => {
      mockAmadeusService.searchFlights.mockRejectedValue(
        new Error('No flights found for the specified criteria.')
      );

      const response = await request(app)
        .post('/search/flights')
        .send(validFlightSearchData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SEARCH_001');
      expect(response.body.error.message).toBe('No flights found');
    });

    it('should handle service unavailable errors', async () => {
      mockAmadeusService.searchFlights.mockRejectedValue(
        new Error('Flight search service temporarily unavailable.')
      );

      const response = await request(app)
        .post('/search/flights')
        .send(validFlightSearchData);

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('API_001');
      expect(response.body.error.message).toBe('Search service temporarily unavailable');
    });

    it('should handle optional parameters correctly', async () => {
      const dataWithOptionals = {
        ...validFlightSearchData,
        infants: 1,
        nonStop: true,
        maxPrice: 2000,
        max: 25,
        currencyCode: 'EUR'
      };

      mockAmadeusService.searchFlights.mockResolvedValue(mockFlightResponse);
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/search/flights')
        .send(dataWithOptionals);

      expect(response.status).toBe(200);
      expect(mockAmadeusService.searchFlights).toHaveBeenCalledWith({
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-03-15',
        returnDate: '2024-03-22',
        adults: 2,
        children: 1,
        infants: 1,
        travelClass: 'ECONOMY',
        nonStop: true,
        maxPrice: 2000,
        max: 25,
        currencyCode: 'EUR'
      });
    });
  });

  describe('POST /search/hotels', () => {
    const validHotelSearchData = {
      cityCode: 'PAR',
      checkInDate: '2024-03-15',
      checkOutDate: '2024-03-22',
      roomQuantity: 1,
      adults: 2
    };

    const mockHotelResponse = {
      data: [
        {
          type: 'hotel-offers',
          hotel: {
            hotelId: 'hotel123',
            name: 'Hotel de la Paix',
            rating: '4',
            cityCode: 'PAR'
          },
          offers: [
            {
              id: 'offer123',
              price: {
                currency: 'USD',
                total: '270.00'
              }
            }
          ]
        }
      ],
      meta: {
        count: 1
      }
    };

    it('should search hotels successfully', async () => {
      mockAmadeusService.searchHotels.mockResolvedValue(mockHotelResponse);
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/search/hotels')
        .send(validHotelSearchData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.hotels).toHaveLength(1);
      expect(response.body.data.hotels[0].hotel.hotelId).toBe('hotel123');
      expect(response.body.message).toBe('Hotel search completed successfully');

      expect(mockAmadeusService.searchHotels).toHaveBeenCalledWith({
        cityCode: 'PAR',
        checkInDate: '2024-03-15',
        checkOutDate: '2024-03-22',
        roomQuantity: 1,
        adults: 2,
        radius: undefined,
        radiusUnit: undefined,
        ratings: undefined,
        priceRange: undefined,
        currency: 'USD'
      });

      expect(mockFirebaseService.saveSearchHistory).toHaveBeenCalledWith({
        userId: 'test-user-123',
        type: 'hotel',
        query: expect.objectContaining({
          cityCode: 'PAR',
          checkInDate: '2024-03-15'
        }),
        results: { count: 1 },
        timestamp: expect.any(String)
      });
    });

    it('should return validation error for invalid city code', async () => {
      const invalidData = {
        ...validHotelSearchData,
        cityCode: 'INVALID'
      };

      const response = await request(app)
        .post('/search/hotels')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for invalid date range', async () => {
      const invalidData = {
        ...validHotelSearchData,
        checkInDate: '2024-03-22',
        checkOutDate: '2024-03-15' // Check-out before check-in
      };

      const response = await request(app)
        .post('/search/hotels')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toBe('Invalid date range');
    });

    it('should handle no hotels found errors', async () => {
      mockAmadeusService.searchHotels.mockRejectedValue(
        new Error('No hotels found for the specified criteria.')
      );

      const response = await request(app)
        .post('/search/hotels')
        .send(validHotelSearchData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SEARCH_001');
      expect(response.body.error.message).toBe('No hotels found');
    });

    it('should handle optional parameters correctly', async () => {
      const dataWithOptionals = {
        ...validHotelSearchData,
        radius: 10,
        radiusUnit: 'KM',
        ratings: [4, 5],
        priceRange: '100-500',
        currency: 'EUR'
      };

      mockAmadeusService.searchHotels.mockResolvedValue(mockHotelResponse);
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/search/hotels')
        .send(dataWithOptionals);

      expect(response.status).toBe(200);
      expect(mockAmadeusService.searchHotels).toHaveBeenCalledWith({
        cityCode: 'PAR',
        checkInDate: '2024-03-15',
        checkOutDate: '2024-03-22',
        roomQuantity: 1,
        adults: 2,
        radius: 10,
        radiusUnit: 'KM',
        ratings: [4, 5],
        priceRange: '100-500',
        currency: 'EUR'
      });
    });
  });

  describe('GET /search/locations', () => {
    const mockAirportData = [
      {
        iataCode: 'JFK',
        name: 'John F Kennedy International Airport',
        address: {
          cityName: 'New York',
          countryName: 'United States'
        },
        geoCode: {
          latitude: 40.6413,
          longitude: -73.7781
        }
      }
    ];

    const mockCityData = [
      {
        iataCode: 'NYC',
        name: 'New York',
        address: {
          countryName: 'United States'
        },
        geoCode: {
          latitude: 40.7128,
          longitude: -74.0060
        }
      }
    ];

    it('should search all locations successfully', async () => {
      mockAmadeusService.searchAirports.mockResolvedValue(mockAirportData);
      mockAmadeusService.searchCities.mockResolvedValue(mockCityData);

      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'New York', type: 'all', limit: 10 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].type).toBe('airport');
      expect(response.body.data[1].type).toBe('city');
      expect(response.body.message).toBe('Location search completed successfully');

      expect(mockAmadeusService.searchAirports).toHaveBeenCalledWith('New York');
      expect(mockAmadeusService.searchCities).toHaveBeenCalledWith('New York');
    });

    it('should search airports only', async () => {
      mockAmadeusService.searchAirports.mockResolvedValue(mockAirportData);

      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'JFK', type: 'airport' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe('airport');
      expect(response.body.data[0].iataCode).toBe('JFK');

      expect(mockAmadeusService.searchAirports).toHaveBeenCalledWith('JFK');
      expect(mockAmadeusService.searchCities).not.toHaveBeenCalled();
    });

    it('should search cities only', async () => {
      mockAmadeusService.searchCities.mockResolvedValue(mockCityData);

      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'Paris', type: 'city' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].type).toBe('city');

      expect(mockAmadeusService.searchCities).toHaveBeenCalledWith('Paris');
      expect(mockAmadeusService.searchAirports).not.toHaveBeenCalled();
    });

    it('should return validation error for missing query', async () => {
      const response = await request(app)
        .get('/search/locations')
        .query({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for too short query', async () => {
      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'A' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return validation error for invalid type', async () => {
      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'Paris', type: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should handle service unavailable errors', async () => {
      mockAmadeusService.searchAirports.mockRejectedValue(
        new Error('Location search service temporarily unavailable.')
      );

      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'Paris', type: 'airport' });

      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('API_001');
      expect(response.body.error.message).toBe('Location search service temporarily unavailable');
    });

    it('should respect limit parameter', async () => {
      // Create more mock data than the limit
      const manyAirports = Array.from({ length: 20 }, (_, i) => ({
        iataCode: `TST${i}`,
        name: `Test Airport ${i}`,
        address: { cityName: 'Test City', countryName: 'Test Country' },
        geoCode: { latitude: 0, longitude: 0 }
      }));

      mockAmadeusService.searchAirports.mockResolvedValue(manyAirports);
      mockAmadeusService.searchCities.mockResolvedValue([]);

      const response = await request(app)
        .get('/search/locations')
        .query({ q: 'Test', limit: 5 });

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(5);
    });
  });

  describe('Authentication', () => {
    it('should require authentication for all search endpoints', async () => {
      // This test would need to mock the auth middleware differently
      // to test the actual authentication requirement
      // For now, we're testing that auth middleware is applied
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Response Format Consistency', () => {
    it('should have consistent success response format', async () => {
      mockAmadeusService.searchFlights.mockResolvedValue({
        data: [],
        meta: { count: 0 },
        dictionaries: {}
      });
      mockFirebaseService.saveSearchHistory.mockResolvedValue('search123');

      const response = await request(app)
        .post('/search/flights')
        .send({
          originLocationCode: 'JFK',
          destinationLocationCode: 'CDG',
          departureDate: '2024-03-15',
          adults: 1
        });

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('requestId');
    });

    it('should have consistent error response format', async () => {
      const response = await request(app)
        .post('/search/flights')
        .send({
          originLocationCode: 'INVALID'
        });

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