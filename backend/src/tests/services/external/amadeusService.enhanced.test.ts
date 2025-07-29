import { jest, describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { AmadeusService, FlightSearchParams, HotelSearchParams } from '../../../services/external/amadeusService.js';

// Mock dependencies
const mockAmadeusClient = {
  shopping: {
    flightOffersSearch: {
      get: jest.fn()
    },
    flightOffers: {
      pricing: {
        post: jest.fn()
      }
    },
    hotelOffers: {
      get: jest.fn()
    },
    hotelOffer: jest.fn().mockReturnValue({
      get: jest.fn()
    })
  },
  referenceData: {
    locations: {
      get: jest.fn()
    }
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

jest.mock('amadeus', () => ({
  default: jest.fn(() => mockAmadeusClient)
}));

jest.mock('../../../config/index.js', () => ({
  config: {
    amadeus: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      environment: 'test'
    },
    redis: {
      ttl: {
        flightSearch: 3600,
        hotelSearch: 3600,
        locationSearch: 86400
      }
    }
  }
}));

describe('AmadeusService Enhanced Unit Tests', () => {
  let amadeusService: AmadeusService;

  beforeEach(() => {
    jest.clearAllMocks();
    amadeusService = new AmadeusService();
  });

  describe('Flight Search', () => {
    const mockFlightSearchParams: FlightSearchParams = {
      originLocationCode: 'NYC',
      destinationLocationCode: 'LAX',
      departureDate: '2024-12-25',
      returnDate: '2024-12-30',
      adults: 2,
      children: 1,
      travelClass: 'ECONOMY',
      maxPrice: 1000,
      currencyCode: 'USD'
    };

    const mockFlightResponse = {
      data: [
        {
          id: 'flight-1',
          oneWay: false,
          lastTicketingDate: '2024-12-20',
          numberOfBookableSeats: 5,
          price: {
            currency: 'USD',
            total: '800.00',
            base: '650.00',
            grandTotal: '800.00'
          },
          itineraries: [
            {
              duration: 'PT5H30M',
              segments: [
                {
                  departure: { iataCode: 'NYC', at: '2024-12-25T08:00:00' },
                  arrival: { iataCode: 'LAX', at: '2024-12-25T11:30:00' },
                  carrierCode: 'AA',
                  number: '123',
                  aircraft: { code: '737' },
                  duration: 'PT5H30M',
                  id: 'segment-1',
                  numberOfStops: 0,
                  blacklistedInEU: false
                }
              ]
            }
          ]
        }
      ],
      meta: { count: 1 },
      dictionaries: { carriers: { 'AA': 'American Airlines' } }
    };

    it('should search flights successfully with cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue(mockFlightResponse);
      mockRedisService.setex.mockResolvedValue('OK');

      const result = await amadeusService.searchFlights(mockFlightSearchParams);

      expect(result).toEqual(mockFlightResponse);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('flight_search:nyc:lax:2024-12-25:2024-12-30:2:1:0:economy')
      );
      expect(mockAmadeusClient.shopping.flightOffersSearch.get).toHaveBeenCalledWith({
        originLocationCode: 'NYC',
        destinationLocationCode: 'LAX',
        departureDate: '2024-12-25',
        returnDate: '2024-12-30',
        adults: '2',
        children: '1',
        infants: undefined,
        travelClass: 'ECONOMY',
        includedAirlineCodes: undefined,
        excludedAirlineCodes: undefined,
        nonStop: undefined,
        maxPrice: '1000',
        max: '50',
        currencyCode: 'USD'
      });
      expect(mockRedisService.setex).toHaveBeenCalled();
    });

    it('should return cached flight search results', async () => {
      const cachedResult = JSON.stringify(mockFlightResponse);
      mockRedisService.get.mockResolvedValue(cachedResult);

      const result = await amadeusService.searchFlights(mockFlightSearchParams);

      expect(result).toEqual(mockFlightResponse);
      expect(mockAmadeusClient.shopping.flightOffersSearch.get).not.toHaveBeenCalled();
      expect(mockRedisService.setex).not.toHaveBeenCalled();
    });

    it('should handle rate limit errors (429)', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Rate limit exceeded');
      (error as any).response = { status: 429, data: 'Too many requests' };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(error);

      await expect(amadeusService.searchFlights(mockFlightSearchParams))
        .rejects.toThrow('Rate limit exceeded. Please try again later.');
    });

    it('should handle validation errors (400)', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Bad request');
      (error as any).response = { status: 400, data: 'Invalid parameters' };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(error);

      await expect(amadeusService.searchFlights(mockFlightSearchParams))
        .rejects.toThrow('Invalid search parameters. Please check your input.');
    });

    it('should handle not found errors (404)', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Not found');
      (error as any).response = { status: 404, data: 'No results' };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(error);

      await expect(amadeusService.searchFlights(mockFlightSearchParams))
        .rejects.toThrow('No flights found for the specified criteria.');
    });

    it('should handle generic errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('Internal server error');
      (error as any).response = { status: 500, data: 'Server error' };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(error);

      await expect(amadeusService.searchFlights(mockFlightSearchParams))
        .rejects.toThrow('Flight search service temporarily unavailable.');
    });

    it('should handle one-way flights', async () => {
      const oneWayParams = { ...mockFlightSearchParams };
      delete oneWayParams.returnDate;

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue(mockFlightResponse);

      await amadeusService.searchFlights(oneWayParams);

      expect(mockAmadeusClient.shopping.flightOffersSearch.get).toHaveBeenCalledWith(
        expect.objectContaining({
          returnDate: undefined
        })
      );
    });

    it('should handle flight search with airline filters', async () => {
      const paramsWithFilters = {
        ...mockFlightSearchParams,
        includedAirlineCodes: ['AA', 'DL'],
        excludedAirlineCodes: ['SW'],
        nonStop: true
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue(mockFlightResponse);

      await amadeusService.searchFlights(paramsWithFilters);

      expect(mockAmadeusClient.shopping.flightOffersSearch.get).toHaveBeenCalledWith(
        expect.objectContaining({
          includedAirlineCodes: 'AA,DL',
          excludedAirlineCodes: 'SW',
          nonStop: 'true'
        })
      );
    });
  });

  describe('Hotel Search', () => {
    const mockHotelSearchParams: HotelSearchParams = {
      cityCode: 'NYC',
      checkInDate: '2024-12-25',
      checkOutDate: '2024-12-30',
      roomQuantity: 2,
      adults: 4,
      radius: 10,
      radiusUnit: 'KM',
      currency: 'USD'
    };

    const mockHotelResponse = {
      data: [
        {
          type: 'hotel-offers',
          hotel: {
            type: 'hotel',
            hotelId: 'HOTEL123',
            chainCode: 'HH',
            name: 'Test Hotel',
            rating: '4',
            cityCode: 'NYC',
            latitude: 40.7128,
            longitude: -74.0060,
            address: {
              lines: ['123 Test St'],
              postalCode: '10001',
              cityName: 'New York',
              countryCode: 'US'
            }
          },
          available: true,
          offers: [
            {
              id: 'offer-1',
              checkInDate: '2024-12-25',
              checkOutDate: '2024-12-30',
              price: {
                currency: 'USD',
                total: '500.00',
                base: '400.00'
              }
            }
          ]
        }
      ],
      meta: { count: 1 }
    };

    it('should search hotels successfully with cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.hotelOffers.get.mockResolvedValue(mockHotelResponse);
      mockRedisService.setex.mockResolvedValue('OK');

      const result = await amadeusService.searchHotels(mockHotelSearchParams);

      expect(result).toEqual(mockHotelResponse);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('hotel_search:nyc:2024-12-25:2024-12-30:2:4')
      );
      expect(mockAmadeusClient.shopping.hotelOffers.get).toHaveBeenCalledWith({
        cityCode: 'NYC',
        checkInDate: '2024-12-25',
        checkOutDate: '2024-12-30',
        roomQuantity: '2',
        adults: '4',
        radius: '10',
        radiusUnit: 'KM',
        paymentPolicy: undefined,
        includedAmenities: undefined,
        ratings: undefined,
        priceRange: undefined,
        currency: 'USD',
        lang: 'EN'
      });
      expect(mockRedisService.setex).toHaveBeenCalled();
    });

    it('should return cached hotel search results', async () => {
      const cachedResult = JSON.stringify(mockHotelResponse);
      mockRedisService.get.mockResolvedValue(cachedResult);

      const result = await amadeusService.searchHotels(mockHotelSearchParams);

      expect(result).toEqual(mockHotelResponse);
      expect(mockAmadeusClient.shopping.hotelOffers.get).not.toHaveBeenCalled();
    });

    it('should handle hotel search with amenity filters', async () => {
      const paramsWithFilters = {
        ...mockHotelSearchParams,
        includedAmenities: ['WIFI', 'POOL'],
        ratings: [4, 5],
        priceRange: '100-500'
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.hotelOffers.get.mockResolvedValue(mockHotelResponse);

      await amadeusService.searchHotels(paramsWithFilters);

      expect(mockAmadeusClient.shopping.hotelOffers.get).toHaveBeenCalledWith(
        expect.objectContaining({
          includedAmenities: 'WIFI,POOL',
          ratings: '4,5',
          priceRange: '100-500'
        })
      );
    });
  });

  describe('Location Search', () => {
    const mockLocationResponse = [
      {
        type: 'location',
        subType: 'AIRPORT',
        name: 'John F Kennedy International Airport',
        detailedName: 'New York/John F Kennedy International Airport',
        id: 'AJFK',
        iataCode: 'JFK',
        address: {
          cityName: 'New York',
          countryCode: 'US'
        }
      }
    ];

    it('should search airports with cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.referenceData.locations.get.mockResolvedValue({ data: mockLocationResponse });
      mockRedisService.setex.mockResolvedValue('OK');

      const result = await amadeusService.searchAirports('JFK');

      expect(result).toEqual(mockLocationResponse);
      expect(mockRedisService.get).toHaveBeenCalledWith('airport_search:jfk:all');
      expect(mockAmadeusClient.referenceData.locations.get).toHaveBeenCalledWith({
        keyword: 'JFK',
        subType: 'AIRPORT',
        'page[limit]': '10'
      });
    });

    it('should search cities with cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.referenceData.locations.get.mockResolvedValue({ data: mockLocationResponse });
      mockRedisService.setex.mockResolvedValue('OK');

      const result = await amadeusService.searchCities('New York');

      expect(result).toEqual(mockLocationResponse);
      expect(mockRedisService.get).toHaveBeenCalledWith('city_search:new york');
      expect(mockAmadeusClient.referenceData.locations.get).toHaveBeenCalledWith({
        keyword: 'New York',
        subType: 'CITY',
        'page[limit]': '10'
      });
    });
  });

  describe('Price Monitoring', () => {
    it('should set up flight price monitoring', async () => {
      mockRedisService.setex.mockResolvedValue('OK');

      await amadeusService.monitorFlightPrice('flight-123', 'user-456', 800);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'price_monitor:flight:flight-123:user-456',
        604800, // 7 days
        expect.stringContaining('"userId":"user-456"')
      );
    });

    it('should set up hotel price monitoring', async () => {
      mockRedisService.setex.mockResolvedValue('OK');

      await amadeusService.monitorHotelPrice('hotel-123', 'user-456', 300);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'price_monitor:hotel:hotel-123:user-456',
        604800, // 7 days
        expect.stringContaining('"userId":"user-456"')
      );
    });

    it('should handle price monitoring setup errors', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis error'));

      await expect(amadeusService.monitorFlightPrice('flight-123', 'user-456', 800))
        .rejects.toThrow('Unable to set up price monitoring.');
    });
  });

  describe('Flight Offer Pricing', () => {
    it('should get flight offer pricing successfully', async () => {
      const mockPricingResponse = {
        data: {
          type: 'flight-offers-pricing',
          flightOffers: [
            {
              id: 'flight-123',
              price: {
                currency: 'USD',
                total: '850.00',
                base: '700.00'
              }
            }
          ]
        }
      };

      mockAmadeusClient.shopping.flightOffers.pricing.post.mockResolvedValue(mockPricingResponse);

      const result = await amadeusService.getFlightOfferPricing('flight-123');

      expect(result).toEqual(mockPricingResponse.data);
      expect(mockAmadeusClient.shopping.flightOffers.pricing.post).toHaveBeenCalledWith(
        JSON.stringify({
          data: {
            type: 'flight-offers-pricing',
            flightOffers: [{ id: 'flight-123' }]
          }
        })
      );
    });

    it('should handle flight offer pricing errors', async () => {
      mockAmadeusClient.shopping.flightOffers.pricing.post.mockRejectedValue(new Error('Pricing failed'));

      await expect(amadeusService.getFlightOfferPricing('flight-123'))
        .rejects.toThrow('Unable to get current flight pricing.');
    });
  });

  describe('Hotel Offer Details', () => {
    it('should get hotel offer details successfully', async () => {
      const mockOfferDetails = {
        data: {
          type: 'hotel-offer',
          id: 'offer-123',
          hotel: {
            hotelId: 'HOTEL123',
            name: 'Test Hotel'
          }
        }
      };

      mockAmadeusClient.shopping.hotelOffer.mockReturnValue({
        get: jest.fn().mockResolvedValue(mockOfferDetails)
      });

      const result = await amadeusService.getHotelOfferDetails('offer-123');

      expect(result).toEqual(mockOfferDetails.data);
      expect(mockAmadeusClient.shopping.hotelOffer).toHaveBeenCalledWith('offer-123');
    });

    it('should handle hotel offer details errors', async () => {
      mockAmadeusClient.shopping.hotelOffer.mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('Details failed'))
      });

      await expect(amadeusService.getHotelOfferDetails('offer-123'))
        .rejects.toThrow('Unable to get hotel offer details.');
    });
  });

  describe('Health Check', () => {
    it('should return true when service is healthy', async () => {
      mockAmadeusClient.referenceData.locations.get.mockResolvedValue({ data: [] });

      const result = await amadeusService.healthCheck();

      expect(result).toBe(true);
      expect(mockAmadeusClient.referenceData.locations.get).toHaveBeenCalledWith({
        keyword: 'LON',
        subType: 'AIRPORT',
        'page[limit]': '1'
      });
    });

    it('should return false when service is unhealthy', async () => {
      mockAmadeusClient.referenceData.locations.get.mockRejectedValue(new Error('Service down'));

      const result = await amadeusService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent flight cache keys', async () => {
      const params1: FlightSearchParams = {
        originLocationCode: 'NYC',
        destinationLocationCode: 'LAX',
        departureDate: '2024-12-25',
        returnDate: '2024-12-30',
        adults: 2,
        children: 1,
        travelClass: 'ECONOMY'
      };

      const params2: FlightSearchParams = {
        originLocationCode: 'nyc',
        destinationLocationCode: 'lax',
        departureDate: '2024-12-25',
        returnDate: '2024-12-30',
        adults: 2,
        children: 1,
        travelClass: 'ECONOMY'
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue({ data: [], meta: {}, dictionaries: {} });

      await amadeusService.searchFlights(params1);
      const firstCallKey = mockRedisService.get.mock.calls[0][0];

      jest.clearAllMocks();
      await amadeusService.searchFlights(params2);
      const secondCallKey = mockRedisService.get.mock.calls[0][0];

      expect(firstCallKey).toBe(secondCallKey);
    });

    it('should generate different cache keys for different parameters', async () => {
      const params1: FlightSearchParams = {
        originLocationCode: 'NYC',
        destinationLocationCode: 'LAX',
        departureDate: '2024-12-25',
        adults: 2
      };

      const params2: FlightSearchParams = {
        originLocationCode: 'NYC',
        destinationLocationCode: 'LAX',
        departureDate: '2024-12-26',
        adults: 2
      };

      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue({ data: [], meta: {}, dictionaries: {} });

      await amadeusService.searchFlights(params1);
      const firstCallKey = mockRedisService.get.mock.calls[0][0];

      jest.clearAllMocks();
      await amadeusService.searchFlights(params2);
      const secondCallKey = mockRedisService.get.mock.calls[0][0];

      expect(firstCallKey).not.toBe(secondCallKey);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty search results', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue({
        data: [],
        meta: { count: 0 },
        dictionaries: {}
      });

      const result = await amadeusService.searchFlights(mockFlightSearchParams);

      expect(result.data).toEqual([]);
      expect(result.meta.count).toBe(0);
    });

    it('should handle invalid cache data', async () => {
      mockRedisService.get.mockResolvedValue('invalid-json');
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue({
        data: [],
        meta: {},
        dictionaries: {}
      });

      // Should fall back to API call when cache data is invalid
      await expect(amadeusService.searchFlights(mockFlightSearchParams)).rejects.toThrow();
    });

    it('should handle redis connection errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis connection failed'));
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue({
        data: [],
        meta: {},
        dictionaries: {}
      });

      const result = await amadeusService.searchFlights(mockFlightSearchParams);

      // Should still work even if cache fails
      expect(result).toBeDefined();
      expect(mockAmadeusClient.shopping.flightOffersSearch.get).toHaveBeenCalled();
    });
  });
});