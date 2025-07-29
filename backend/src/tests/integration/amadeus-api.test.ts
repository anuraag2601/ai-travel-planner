import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { AmadeusService, FlightSearchParams, HotelSearchParams } from '../../services/external/amadeusService.js';
// import nock from 'nock';

// Integration test for external API calls and error handling
describe('AmadeusService Integration Tests', () => {
  let amadeusService: AmadeusService;
  let mockRedisService: any;

  beforeAll(() => {
    // Mock Redis service for integration tests
    mockRedisService = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn()
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
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisService.get.mockResolvedValue(null); // No cache by default
    mockRedisService.setex.mockResolvedValue('OK');
    
    amadeusService = new AmadeusService();
  });

  afterEach(() => {
    // nock.cleanAll();
  });

  afterAll(() => {
    // nock.restore();
  });

  describe('Flight Search Integration', () => {
    const flightParams: FlightSearchParams = {
      originLocationCode: 'JFK',
      destinationLocationCode: 'CDG',
      departureDate: '2024-06-15',
      returnDate: '2024-06-22',
      adults: 2,
      children: 1,
      travelClass: 'ECONOMY'
    };

    it('should successfully search flights with real API structure', async () => {
      const mockFlightResponse = {
        data: [
          {
            type: 'flight-offer',
            id: '1',
            source: 'GDS',
            oneWay: false,
            lastTicketingDate: '2024-06-14',
            numberOfBookableSeats: 9,
            itineraries: [
              {
                duration: 'PT8H30M',
                segments: [
                  {
                    departure: {
                      iataCode: 'JFK',
                      terminal: '4',
                      at: '2024-06-15T18:35:00'
                    },
                    arrival: {
                      iataCode: 'CDG',
                      terminal: '2E',
                      at: '2024-06-16T07:05:00'
                    },
                    carrierCode: 'AF',
                    number: '007',
                    aircraft: {
                      code: '77W'
                    },
                    operating: {
                      carrierCode: 'AF'
                    },
                    duration: 'PT8H30M',
                    id: '1',
                    numberOfStops: 0
                  }
                ]
              }
            ],
            price: {
              currency: 'USD',
              total: '1245.50',
              base: '1105.50',
              fees: [
                {
                  amount: '140.00',
                  type: 'SUPPLIER'
                }
              ]
            },
            pricingOptions: {
              fareType: ['PUBLISHED'],
              includedCheckedBagsOnly: true
            },
            validatingAirlineCodes: ['AF'],
            travelerPricings: [
              {
                travelerId: '1',
                fareOption: 'STANDARD',
                travelerType: 'ADULT',
                price: {
                  currency: 'USD',
                  total: '622.75'
                }
              }
            ]
          }
        ],
        meta: {
          count: 1,
          links: {
            self: 'https://test.api.amadeus.com/v2/shopping/flight-offers'
          }
        },
        dictionaries: {
          locations: {
            JFK: {
              cityCode: 'NYC',
              countryCode: 'US'
            },
            CDG: {
              cityCode: 'PAR',
              countryCode: 'FR'
            }
          },
          aircraft: {
            '77W': 'BOEING 777-300ER'
          },
          carriers: {
            AF: 'AIR FRANCE'
          }
        }
      };

      // Mock Amadeus API endpoint
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(200, mockFlightResponse);

      const result = await amadeusService.searchFlights(flightParams);

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].price.total).toBe('1245.50');
      expect(result.data[0].itineraries[0].segments[0].departure.iataCode).toBe('JFK');
      expect(result.data[0].itineraries[0].segments[0].arrival.iataCode).toBe('CDG');
      
      // Verify caching was attempted
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('flight_search'),
        3600,
        JSON.stringify(mockFlightResponse)
      );
    });

    it('should handle Amadeus API rate limiting correctly', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(429, {
          errors: [
            {
              status: 429,
              code: 4926,
              title: 'Too Many Requests',
              detail: 'API rate limit exceeded'
            }
          ]
        });

      await expect(amadeusService.searchFlights(flightParams))
        .rejects.toThrow('Rate limit exceeded. Please try again later.');
    });

    it('should handle invalid airport codes', async () => {
      const invalidParams = {
        ...flightParams,
        originLocationCode: 'INVALID'
      };

      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(400, {
          errors: [
            {
              status: 400,
              code: 477,
              title: 'INVALID FORMAT',
              detail: 'Invalid airport code',
              source: {
                parameter: 'originLocationCode'
              }
            }
          ]
        });

      await expect(amadeusService.searchFlights(invalidParams))
        .rejects.toThrow('Invalid search parameters. Please check your input.');
    });

    it('should handle no flights found scenario', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(404, {
          errors: [
            {
              status: 404,
              code: 6003,
              title: 'ITEM/DATA NOT FOUND OR DATA NOT EXISTING',
              detail: 'No flight found'
            }
          ]
        });

      await expect(amadeusService.searchFlights(flightParams))
        .rejects.toThrow('No flights found for the specified criteria.');
    });

    it('should handle network timeouts gracefully', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .delay(10000) // Simulate timeout
        .reply(200, {});

      await expect(amadeusService.searchFlights(flightParams))
        .rejects.toThrow('Flight search service temporarily unavailable.');
    });

    it('should handle malformed API responses', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(200, 'Invalid JSON response');

      await expect(amadeusService.searchFlights(flightParams))
        .rejects.toThrow('Flight search service temporarily unavailable.');
    });
  });

  describe('Hotel Search Integration', () => {
    const hotelParams: HotelSearchParams = {
      cityCode: 'PAR',
      checkInDate: '2024-06-15',
      checkOutDate: '2024-06-22',
      roomQuantity: 1,
      adults: 2
    };

    it('should successfully search hotels with real API structure', async () => {
      const mockHotelResponse = {
        data: [
          {
            type: 'hotel-offers',
            hotel: {
              type: 'hotel',
              hotelId: 'MCLONGHM',
              chainCode: 'MC',
              dupeId: '700022612',
              name: 'HOTEL LONGCHAMP ELYSEES',
              rating: '4',
              cityCode: 'PAR',
              latitude: 48.87413,
              longitude: 2.28784,
              hotelDistance: {
                distance: 2.5,
                distanceUnit: 'KM'
              },
              address: {
                lines: ['68 RUE DE LONGCHAMP'],
                postalCode: '75116',
                cityName: 'PARIS',
                countryCode: 'FR'
              },
              contact: {
                phone: '(33) 147046161'
              },
              description: {
                lang: 'en',
                text: 'Located in the heart of Paris'
              },
              amenities: ['WIFI', 'PARKING', 'AIR_CONDITIONING'],
              media: [
                {
                  uri: 'https://example.com/hotel-image.jpg',
                  category: 'EXTERIOR'
                }
              ]
            },
            available: true,
            offers: [
              {
                id: 'OFFER1',
                checkInDate: '2024-06-15',
                checkOutDate: '2024-06-22',
                rateCode: 'RAC',
                rateFamilyEstimated: {
                  code: 'BAR',
                  type: 'P'
                },
                category: 'STANDARD_ROOM',
                description: {
                  text: 'Standard Room'
                },
                commission: {
                  percentage: '7.00'
                },
                boardType: 'ROOM_ONLY',
                room: {
                  type: 'STANDARD',
                  typeEstimated: {
                    category: 'STANDARD_ROOM',
                    beds: 1,
                    bedType: 'DOUBLE'
                  },
                  description: {
                    text: 'Standard room with double bed'
                  }
                },
                guests: {
                  adults: 2
                },
                price: {
                  currency: 'EUR',
                  base: '980.00',
                  total: '1078.00',
                  taxes: [
                    {
                      amount: '98.00',
                      currency: 'EUR',
                      code: 'CITY_TAX'
                    }
                  ],
                  variations: {
                    average: {
                      base: '140.00'
                    },
                    changes: [
                      {
                        startDate: '2024-06-15',
                        endDate: '2024-06-22',
                        base: '140.00'
                      }
                    ]
                  }
                },
                policies: {
                  cancellations: [
                    {
                      amount: '540.00',
                      deadline: '2024-06-14T18:00:00.000+02:00'
                    }
                  ],
                  paymentType: 'guarantee',
                  guarantee: {
                    acceptedPayments: {
                      creditCards: ['VI', 'MC', 'AX']
                    }
                  }
                }
              }
            ]
          }
        ],
        meta: {
          count: 1
        }
      };

      nock('https://test.api.amadeus.com')
        .get('/v3/shopping/hotel-offers')
        .query(true)
        .reply(200, mockHotelResponse);

      const result = await amadeusService.searchHotels(hotelParams);

      expect(result).toBeDefined();
      expect(result.data).toHaveLength(1);
      expect(result.data[0].hotel.name).toBe('HOTEL LONGCHAMP ELYSEES');
      expect(result.data[0].hotel.rating).toBe('4');
      expect(result.data[0].offers[0].price.total).toBe('1078.00');
      
      // Verify caching
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        expect.stringContaining('hotel_search'),
        3600,
        JSON.stringify(mockHotelResponse)
      );
    });

    it('should handle hotels not available for dates', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v3/shopping/hotel-offers')
        .query(true)
        .reply(404, {
          errors: [
            {
              status: 404,
              code: 1797,
              title: 'NOT FOUND',
              detail: 'No hotels available for specified dates and location'
            }
          ]
        });

      await expect(amadeusService.searchHotels(hotelParams))
        .rejects.toThrow('Hotel search service temporarily unavailable.');
    });

    it('should handle invalid city codes', async () => {
      const invalidParams = {
        ...hotelParams,
        cityCode: 'INVALID'
      };

      nock('https://test.api.amadeus.com')
        .get('/v3/shopping/hotel-offers')
        .query(true)
        .reply(400, {
          errors: [
            {
              status: 400,
              code: 477,
              title: 'INVALID FORMAT',
              detail: 'Invalid city code',
              source: {
                parameter: 'cityCode'
              }
            }
          ]
        });

      await expect(amadeusService.searchHotels(invalidParams))
        .rejects.toThrow('Hotel search service temporarily unavailable.');
    });
  });

  describe('Flight Pricing Integration', () => {
    it('should successfully get flight pricing', async () => {
      const mockPricingResponse = {
        data: {
          type: 'flight-offers-pricing',
          flightOffers: [
            {
              type: 'flight-offer',
              id: '1',
              source: 'GDS',
              instantTicketingRequired: false,
              nonHomogeneous: false,
              oneWay: false,
              lastTicketingDate: '2024-06-14',
              numberOfBookableSeats: 9,
              itineraries: [
                {
                  duration: 'PT8H30M',
                  segments: [
                    {
                      departure: {
                        iataCode: 'JFK',
                        terminal: '4',
                        at: '2024-06-15T18:35:00'
                      },
                      arrival: {
                        iataCode: 'CDG',
                        terminal: '2E',
                        at: '2024-06-16T07:05:00'
                      },
                      carrierCode: 'AF',
                      number: '007',
                      aircraft: {
                        code: '77W'
                      },
                      duration: 'PT8H30M',
                      id: '1',
                      numberOfStops: 0
                    }
                  ]
                }
              ],
              price: {
                currency: 'USD',
                total: '1285.50',
                base: '1145.50',
                fees: [
                  {
                    amount: '140.00',
                    type: 'SUPPLIER'
                  }
                ],
                grandTotal: '1285.50'
              },
              pricingOptions: {
                fareType: ['PUBLISHED'],
                includedCheckedBagsOnly: true
              },
              validatingAirlineCodes: ['AF'],
              travelerPricings: [
                {
                  travelerId: '1',
                  fareOption: 'STANDARD',
                  travelerType: 'ADULT',
                  price: {
                    currency: 'USD',
                    total: '642.75',
                    base: '572.75'
                  }
                }
              ]
            }
          ]
        }
      };

      nock('https://test.api.amadeus.com')
        .post('/v1/shopping/flight-offers/pricing')
        .reply(200, mockPricingResponse);

      const result = await amadeusService.getFlightOfferPricing('flight-offer-123');

      expect(result).toBeDefined();
      expect(result.flightOffers).toHaveLength(1);
      expect(result.flightOffers[0].price.total).toBe('1285.50');
    });

    it('should handle pricing unavailable scenarios', async () => {
      nock('https://test.api.amadeus.com')
        .post('/v1/shopping/flight-offers/pricing')
        .reply(400, {
          errors: [
            {
              status: 400,
              code: 4926,
              title: 'INVALID DATA RECEIVED',
              detail: 'Flight offer no longer available for pricing'
            }
          ]
        });

      await expect(amadeusService.getFlightOfferPricing('invalid-offer'))
        .rejects.toThrow('Unable to get current flight pricing.');
    });
  });

  describe('Airport Search Integration', () => {
    it('should successfully search airports', async () => {
      const mockAirportResponse = {
        data: [
          {
            type: 'location',
            subType: 'AIRPORT',
            name: 'John F Kennedy International Airport',
            detailedName: 'John F Kennedy International Airport',
            id: 'CJFK',
            self: {
              href: 'https://test.api.amadeus.com/v1/reference-data/locations/CJFK',
              methods: ['GET']
            },
            timeZoneOffset: '-05:00',
            iataCode: 'JFK',
            geoCode: {
              latitude: 40.64131,
              longitude: -73.77813
            },
            address: {
              cityName: 'NEW YORK',
              cityCode: 'NYC',
              countryName: 'UNITED STATES OF AMERICA',
              countryCode: 'US',
              regionCode: 'NAMER'
            },
            analytics: {
              travelers: {
                score: 100
              }
            }
          },
          {
            type: 'location',
            subType: 'AIRPORT',
            name: 'Newark Liberty International Airport',
            detailedName: 'Newark Liberty International Airport',
            id: 'CEWR',
            self: {
              href: 'https://test.api.amadeus.com/v1/reference-data/locations/CEWR',
              methods: ['GET']
            },
            timeZoneOffset: '-05:00',
            iataCode: 'EWR',
            geoCode: {
              latitude: 40.69247,
              longitude: -74.16847
            },
            address: {
              cityName: 'NEWARK',
              cityCode: 'NYC',
              countryName: 'UNITED STATES OF AMERICA',
              countryCode: 'US',
              regionCode: 'NAMER'
            },
            analytics: {
              travelers: {
                score: 85
              }
            }
          }
        ],
        meta: {
          count: 2,
          links: {
            self: 'https://test.api.amadeus.com/v1/reference-data/locations?keyword=JFK&subType=AIRPORT'
          }
        }
      };

      nock('https://test.api.amadeus.com')
        .get('/v1/reference-data/locations')
        .query(true)
        .reply(200, mockAirportResponse);

      const result = await amadeusService.searchAirports('JFK');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('John F Kennedy International Airport');
      expect(result[0].iataCode).toBe('JFK');
      expect(result[1].iataCode).toBe('EWR');
      
      // Verify caching
      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'airport_search:JFK:all',
        86400,
        JSON.stringify(mockAirportResponse.data)
      );
    });

    it('should handle no airports found', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v1/reference-data/locations')
        .query(true)
        .reply(200, {
          data: [],
          meta: {
            count: 0
          }
        });

      const result = await amadeusService.searchAirports('NONEXISTENT');

      expect(result).toEqual([]);
    });
  });

  describe('Price Monitoring Integration', () => {
    it('should successfully set up price monitoring', async () => {
      const monitoringData = {
        flightOfferId: 'flight-123',
        userId: 'user-456',
        threshold: 1000,
        createdAt: new Date().toISOString(),
        isActive: true
      };

      await amadeusService.monitorFlightPrice('flight-123', 'user-456', 1000);

      expect(mockRedisService.setex).toHaveBeenCalledWith(
        'price_monitor:flight:flight-123:user-456',
        86400 * 7, // 7 days
        expect.stringContaining('"threshold":1000')
      );
    });

    it('should handle price monitoring setup failures', async () => {
      mockRedisService.setex.mockRejectedValue(new Error('Redis connection failed'));

      await expect(amadeusService.monitorFlightPrice('flight-123', 'user-456', 1000))
        .rejects.toThrow('Unable to set up price monitoring.');
    });
  });

  describe('Health Check Integration', () => {
    it('should return true when API is accessible', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v1/reference-data/locations')
        .query({
          keyword: 'LON',
          subType: 'AIRPORT',
          'page[limit]': '1'
        })
        .reply(200, {
          data: [
            {
              type: 'location',
              subType: 'AIRPORT',
              name: 'London Heathrow Airport',
              iataCode: 'LHR'
            }
          ],
          meta: { count: 1 }
        });

      const isHealthy = await amadeusService.healthCheck();

      expect(isHealthy).toBe(true);
    });

    it('should return false when API is inaccessible', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v1/reference-data/locations')
        .query(true)
        .reply(500, {
          errors: [
            {
              status: 500,
              code: 38189,
              title: 'INTERNAL ERROR',
              detail: 'Internal server error'
            }
          ]
        });

      const isHealthy = await amadeusService.healthCheck();

      expect(isHealthy).toBe(false);
    });

    it('should return false on network errors', async () => {
      nock('https://test.api.amadeus.com')
        .get('/v1/reference-data/locations')
        .query(true)
        .replyWithError('Network error');

      const isHealthy = await amadeusService.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });

  describe('Cache Integration', () => {
    it('should use cached results when available', async () => {
      const cachedFlightData = {
        data: [{ id: 'cached-flight', price: { total: '999.99' } }],
        meta: { count: 1 },
        dictionaries: {}
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(cachedFlightData));

      const flightParams: FlightSearchParams = {
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-06-15',
        adults: 1
      };

      const result = await amadeusService.searchFlights(flightParams);

      expect(result).toEqual(cachedFlightData);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        expect.stringContaining('flight_search')
      );
      
      // Should not make API call when cache hit
      expect(nock.pendingMocks()).toHaveLength(0);
    });

    it('should handle cache errors gracefully', async () => {
      mockRedisService.get.mockRejectedValue(new Error('Redis error'));
      mockRedisService.setex.mockResolvedValue('OK');

      const mockFlightResponse = {
        data: [{ id: 'flight-1', price: { total: '1200.00' } }],
        meta: { count: 1 },
        dictionaries: {}
      };

      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(true)
        .reply(200, mockFlightResponse);

      const flightParams: FlightSearchParams = {
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-06-15',
        adults: 1
      };

      const result = await amadeusService.searchFlights(flightParams);

      expect(result).toEqual(mockFlightResponse);
      // Should still attempt to cache the result
      expect(mockRedisService.setex).toHaveBeenCalled();
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple simultaneous flight searches', async () => {
      const mockResponse = {
        data: [{ id: 'flight-concurrent', price: { total: '800.00' } }],
        meta: { count: 1 },
        dictionaries: {}
      };

      // Set up multiple API mock responses
      for (let i = 0; i < 3; i++) {
        nock('https://test.api.amadeus.com')
          .get('/v2/shopping/flight-offers')
          .query(true)
          .reply(200, mockResponse);
      }

      const flightParams: FlightSearchParams = {
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-06-15',
        adults: 1
      };

      // Make multiple concurrent requests
      const promises = [
        amadeusService.searchFlights({ ...flightParams, destinationLocationCode: 'CDG' }),
        amadeusService.searchFlights({ ...flightParams, destinationLocationCode: 'LHR' }),
        amadeusService.searchFlights({ ...flightParams, destinationLocationCode: 'FCO' })
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.data[0].id).toBe('flight-concurrent');
      });
    });

    it('should handle mixed success and failure scenarios', async () => {
      // First request succeeds
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(query => query.destinationLocationCode === 'CDG')
        .reply(200, {
          data: [{ id: 'success-flight' }],
          meta: { count: 1 },
          dictionaries: {}
        });

      // Second request fails with rate limit
      nock('https://test.api.amadeus.com')
        .get('/v2/shopping/flight-offers')
        .query(query => query.destinationLocationCode === 'LHR')
        .reply(429, {
          errors: [{ status: 429, title: 'Too Many Requests' }]
        });

      const baseParams: FlightSearchParams = {
        originLocationCode: 'JFK',
        departureDate: '2024-06-15',
        adults: 1
      };

      const results = await Promise.allSettled([
        amadeusService.searchFlights({ ...baseParams, destinationLocationCode: 'CDG' }),
        amadeusService.searchFlights({ ...baseParams, destinationLocationCode: 'LHR' })
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      
      if (results[0].status === 'fulfilled') {
        expect(results[0].value.data[0].id).toBe('success-flight');
      }
      
      if (results[1].status === 'rejected') {
        expect(results[1].reason.message).toContain('Rate limit exceeded');
      }
    });
  });
});