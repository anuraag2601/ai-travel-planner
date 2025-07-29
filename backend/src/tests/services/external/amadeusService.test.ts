import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AmadeusService, FlightSearchParams, HotelSearchParams } from '../../../services/external/amadeusService.js';

// Mock dependencies
const mockAmadeusClient = {
  shopping: {
    flightOffersSearch: {
      get: jest.fn()
    },
    hotelOffers: {
      get: jest.fn()
    },
    flightOffers: {
      pricing: {
        post: jest.fn()
      }
    },
    hotelOffer: jest.fn(() => ({
      get: jest.fn()
    }))
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
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn()
};

// Mock the external dependencies
jest.mock('amadeus', () => ({
  default: jest.fn(() => mockAmadeusClient)
}));

jest.mock('../../../services/redis.js', () => ({
  RedisService: jest.fn(() => mockRedisService)
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

jest.mock('../../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('AmadeusService', () => {
  let amadeusService: AmadeusService;

  beforeEach(() => {
    jest.clearAllMocks();
    amadeusService = new AmadeusService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('searchFlights', () => {
    const mockFlightParams: FlightSearchParams = {
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
          itineraries: []
        }
      ],
      meta: {
        count: 1
      },
      dictionaries: {
        airports: {}
      }
    };

    it('should return cached flight results when available', async () => {
      const cachedResult = JSON.stringify(mockFlightResponse);
      mockRedisService.get.mockResolvedValue(cachedResult);

      const result = await amadeusService.searchFlights(mockFlightParams);

      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('flight_search:jfk:cdg:2024-03-15:2024-03-22:2:1:0:economy')
      );
      expect(mockAmadeusClient.shopping.flightOffersSearch.get).not.toHaveBeenCalled();
      expect(result).toEqual(mockFlightResponse);
    });

    it('should fetch flight data from API when not cached', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.flightOffersSearch.get.mockResolvedValue(mockFlightResponse);

      const result = await amadeusService.searchFlights(mockFlightParams);

      expect(mockAmadeusClient.shopping.flightOffersSearch.get).toHaveBeenCalledWith({
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-03-15',
        returnDate: '2024-03-22',
        adults: '2',
        children: '1',
        infants: undefined,
        travelClass: 'ECONOMY',
        includedAirlineCodes: undefined,
        excludedAirlineCodes: undefined,
        nonStop: undefined,
        maxPrice: undefined,
        max: '50',
        currencyCode: 'USD'
      });
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('flight_search'),
        3600,
        JSON.stringify(mockFlightResponse)
      );
      expect(result).toEqual(mockFlightResponse);
    });

    it('should handle API rate limit errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).response = { status: 429 };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(rateLimitError);

      await expect(amadeusService.searchFlights(mockFlightParams))
        .rejects.toThrow('Rate limit exceeded. Please try again later.');
    });

    it('should handle invalid parameters error', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const badRequestError = new Error('Bad request');
      (badRequestError as any).response = { status: 400 };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(badRequestError);

      await expect(amadeusService.searchFlights(mockFlightParams))
        .rejects.toThrow('Invalid search parameters. Please check your input.');
    });

    it('should handle no flights found error', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const notFoundError = new Error('Not found');
      (notFoundError as any).response = { status: 404 };
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(notFoundError);

      await expect(amadeusService.searchFlights(mockFlightParams))
        .rejects.toThrow('No flights found for the specified criteria.');
    });

    it('should handle generic API errors', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const genericError = new Error('Generic error');
      mockAmadeusClient.shopping.flightOffersSearch.get.mockRejectedValue(genericError);

      await expect(amadeusService.searchFlights(mockFlightParams))
        .rejects.toThrow('Flight search service temporarily unavailable.');
    });
  });

  describe('searchHotels', () => {
    const mockHotelParams: HotelSearchParams = {
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
            name: 'Test Hotel',
            rating: '4'
          },
          offers: []
        }
      ],
      meta: {
        count: 1
      }
    };

    it('should return cached hotel results when available', async () => {
      const cachedResult = JSON.stringify(mockHotelResponse);
      mockRedisService.get.mockResolvedValue(cachedResult);

      const result = await amadeusService.searchHotels(mockHotelParams);

      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('hotel_search:par:2024-03-15:2024-03-22:1:2')
      );
      expect(mockAmadeusClient.shopping.hotelOffers.get).not.toHaveBeenCalled();
      expect(result).toEqual(mockHotelResponse);
    });

    it('should fetch hotel data from API when not cached', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.shopping.hotelOffers.get.mockResolvedValue(mockHotelResponse);

      const result = await amadeusService.searchHotels(mockHotelParams);

      expect(mockAmadeusClient.shopping.hotelOffers.get).toHaveBeenCalledWith({
        cityCode: 'PAR',
        checkInDate: '2024-03-15',
        checkOutDate: '2024-03-22',
        roomQuantity: '1',
        adults: '2',
        radius: undefined,
        radiusUnit: undefined,
        paymentPolicy: undefined,
        includedAmenities: undefined,
        ratings: undefined,
        priceRange: undefined,
        currency: 'USD',
        lang: 'EN'
      });
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('hotel_search'),
        3600,
        JSON.stringify(mockHotelResponse)
      );
      expect(result).toEqual(mockHotelResponse);
    });

    it('should handle hotel search API errors appropriately', async () => {
      mockRedisService.get.mockResolvedValue(null);
      const error = new Error('API Error');
      (error as any).response = { status: 500 };
      mockAmadeusClient.shopping.hotelOffers.get.mockRejectedValue(error);

      await expect(amadeusService.searchHotels(mockHotelParams))
        .rejects.toThrow('Hotel search service temporarily unavailable.');
    });
  });

  describe('getFlightOfferPricing', () => {
    it('should fetch flight pricing successfully', async () => {
      const mockPricingResponse = {
        data: {
          type: 'flight-offers-pricing',
          flightOffers: [
            {
              id: 'flight123',
              price: {
                currency: 'USD',
                total: '1245.50'
              }
            }
          ]
        }
      };

      mockAmadeusClient.shopping.flightOffers.pricing.post.mockResolvedValue(mockPricingResponse);

      const result = await amadeusService.getFlightOfferPricing('flight123');

      expect(mockAmadeusClient.shopping.flightOffers.pricing.post).toHaveBeenCalledWith(
        JSON.stringify({
          data: {
            type: 'flight-offers-pricing',
            flightOffers: [{ id: 'flight123' }]
          }
        })
      );
      expect(result).toEqual(mockPricingResponse.data);
    });

    it('should handle pricing API errors', async () => {
      mockAmadeusClient.shopping.flightOffers.pricing.post.mockRejectedValue(new Error('Pricing error'));

      await expect(amadeusService.getFlightOfferPricing('flight123'))
        .rejects.toThrow('Unable to get current flight pricing.');
    });
  });

  describe('searchAirports', () => {
    it('should return cached airport results when available', async () => {
      const mockAirportData = [
        {
          id: 'JFK',
          name: 'John F Kennedy International Airport',
          iataCode: 'JFK'
        }
      ];
      mockRedisService.get.mockResolvedValue(JSON.stringify(mockAirportData));

      const result = await amadeusService.searchAirports('JFK');

      expect(mockRedisService.get).toHaveBeenCalledWith('airport_search:JFK:all');
      expect(result).toEqual(mockAirportData);
    });

    it('should fetch airport data from API and cache it', async () => {
      const mockAirportResponse = {
        data: [
          {
            id: 'JFK',
            name: 'John F Kennedy International Airport',
            iataCode: 'JFK'
          }
        ]
      };
      mockRedisService.get.mockResolvedValue(null);
      mockAmadeusClient.referenceData.locations.get.mockResolvedValue(mockAirportResponse);

      const result = await amadeusService.searchAirports('JFK');

      expect(mockAmadeusClient.referenceData.locations.get).toHaveBeenCalledWith({
        keyword: 'JFK',
        subType: 'AIRPORT',
        'page[limit]': '10'
      });
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'airport_search:JFK:all',
        86400,
        JSON.stringify(mockAirportResponse.data)
      );
      expect(result).toEqual(mockAirportResponse.data);
    });
  });

  describe('monitorFlightPrice', () => {
    it('should set up flight price monitoring', async () => {
      await amadeusService.monitorFlightPrice('flight123', 'user456', 1000);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'price_monitor:flight:flight123:user456',
        86400 * 7,
        expect.stringContaining('"threshold":1000')
      );
    });

    it('should handle price monitoring setup errors', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis error'));

      await expect(amadeusService.monitorFlightPrice('flight123', 'user456', 1000))
        .rejects.toThrow('Unable to set up price monitoring.');
    });
  });

  describe('healthCheck', () => {
    it('should return true when API is healthy', async () => {
      mockAmadeusClient.referenceData.locations.get.mockResolvedValue({ data: [] });

      const result = await amadeusService.healthCheck();

      expect(result).toBe(true);
      expect(mockAmadeusClient.referenceData.locations.get).toHaveBeenCalledWith({
        keyword: 'LON',
        subType: 'AIRPORT',
        'page[limit]': '1'
      });
    });

    it('should return false when API is unhealthy', async () => {
      mockAmadeusClient.referenceData.locations.get.mockRejectedValue(new Error('API down'));

      const result = await amadeusService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('cache key generation', () => {
    it('should generate consistent cache keys for flights', async () => {
      const params1: FlightSearchParams = {
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-03-15',
        returnDate: '2024-03-22',
        adults: 2
      };

      const params2: FlightSearchParams = {
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-03-15',
        returnDate: '2024-03-22',
        adults: 2
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify({ data: [], meta: {}, dictionaries: {} }));

      await amadeusService.searchFlights(params1);
      const firstCall = mockRedisService.get.mock.calls[0][0];

      await amadeusService.searchFlights(params2);
      const secondCall = mockRedisService.get.mock.calls[1][0];

      expect(firstCall).toBe(secondCall);
    });
  });
});