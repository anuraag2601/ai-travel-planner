import Amadeus from 'amadeus'
import { config } from '@/config/index.js'
import { logger } from '@/utils/logger.js'
import { RedisService } from '@/services/redis.js'

export interface FlightSearchParams {
  originLocationCode: string
  destinationLocationCode: string
  departureDate: string
  returnDate?: string
  adults: number
  children?: number
  infants?: number
  travelClass?: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST'
  includedAirlineCodes?: string[]
  excludedAirlineCodes?: string[]
  nonStop?: boolean
  maxPrice?: number
  max?: number
  currencyCode?: string
}

export interface HotelSearchParams {
  cityCode: string
  checkInDate: string
  checkOutDate: string
  roomQuantity?: number
  adults?: number
  radius?: number
  radiusUnit?: 'KM' | 'MILE'
  paymentPolicy?: 'NONE' | 'GUARANTEE' | 'DEPOSIT'
  includedAmenities?: string[]
  ratings?: number[]
  priceRange?: string
  currency?: string
  lang?: string
}

export interface FlightOffer {
  id: string
  oneWay: boolean
  lastTicketingDate: string
  numberOfBookableSeats: number
  itineraries: FlightItinerary[]
  price: {
    currency: string
    total: string
    base: string
    fees: Array<{
      amount: string
      type: string
    }>
    grandTotal: string
    billingCurrency: string
  }
  pricingOptions: {
    fareType: string[]
    includedCheckedBagsOnly: boolean
  }
  validatingAirlineCodes: string[]
  travelerPricings: Array<{
    travelerId: string
    fareOption: string
    travelerType: string
    price: {
      currency: string
      total: string
      base: string
    }
    fareDetailsBySegment: Array<{
      segmentId: string
      cabin: string
      fareBasis: string
      brandedFare?: string
      class: string
      includedCheckedBags: {
        quantity: number
      }
    }>
  }>
}

export interface FlightItinerary {
  duration: string
  segments: FlightSegment[]
}

export interface FlightSegment {
  departure: {
    iataCode: string
    terminal?: string
    at: string
  }
  arrival: {
    iataCode: string
    terminal?: string
    at: string
  }
  carrierCode: string
  number: string
  aircraft: {
    code: string
  }
  operating?: {
    carrierCode: string
  }
  duration: string
  id: string
  numberOfStops: number
  blacklistedInEU: boolean
}

export interface HotelOffer {
  type: string
  hotel: {
    type: string
    hotelId: string
    chainCode: string
    dupeId: string
    name: string
    rating: string
    cityCode: string
    latitude: number
    longitude: number
    hotelDistance: {
      distance: number
      distanceUnit: string
    }
    address: {
      lines: string[]
      postalCode: string
      cityName: string
      countryCode: string
    }
    contact: {
      phone: string
      fax: string
      email: string
    }
    description: {
      lang: string
      text: string
    }
    amenities: string[]
    media: Array<{
      uri: string
      category: string
    }>
  }
  available: boolean
  offers: Array<{
    id: string
    checkInDate: string
    checkOutDate: string
    rateCode: string
    rateFamilyEstimated: {
      code: string
      type: string
    }
    commission: {
      percentage: string
    }
    boardType: string
    room: {
      type: string
      typeEstimated: {
        category: string
        beds: number
        bedType: string
      }
      description: {
        text: string
        lang: string
      }
    }
    guests: {
      adults: number
    }
    price: {
      currency: string
      base: string
      total: string
      taxes: Array<{
        amount: string
        currency: string
        code: string
        percentage: string
        included: boolean
        description: string
        pricingFrequency: string
        pricingMode: string
      }>
      variations: {
        average: {
          base: string
        }
        changes: Array<{
          startDate: string
          endDate: string
          base: string
        }>
      }
    }
    policies: {
      paymentType: string
      cancellation: {
        type: string
        amount: string
        numberOfNights: number
        percentage: string
        deadline: string
      }
    }
    self: string
  }>
  self: string
}

export class AmadeusService {
  private client: Amadeus
  private redis: RedisService

  constructor() {
    this.client = new Amadeus({
      clientId: config.amadeus.clientId,
      clientSecret: config.amadeus.clientSecret,
      environment: config.amadeus.environment,
    })
    
    this.redis = new RedisService()
  }

  // Flight search methods
  async searchFlights(params: FlightSearchParams): Promise<{
    data: FlightOffer[]
    meta: any
    dictionaries: any
  }> {
    try {
      // Generate cache key
      const cacheKey = this.generateFlightCacheKey(params)
      
      // Check cache first
      const cachedResult = await this.redis.get(cacheKey)
      if (cachedResult) {
        logger.info('Flight search result retrieved from cache', { cacheKey })
        return JSON.parse(cachedResult)
      }

      // Make API request
      logger.info('Searching flights via Amadeus API', { params })
      
      const response = await this.client.shopping.flightOffersSearch.get({
        originLocationCode: params.originLocationCode,
        destinationLocationCode: params.destinationLocationCode,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        adults: params.adults.toString(),
        children: params.children?.toString(),
        infants: params.infants?.toString(),
        travelClass: params.travelClass,
        includedAirlineCodes: params.includedAirlineCodes?.join(','),
        excludedAirlineCodes: params.excludedAirlineCodes?.join(','),
        nonStop: params.nonStop?.toString(),
        maxPrice: params.maxPrice?.toString(),
        max: (params.max || 50).toString(),
        currencyCode: params.currencyCode || 'USD',
      })

      const result = {
        data: response.data,
        meta: response.meta,
        dictionaries: response.dictionaries,
      }

      // Cache the result
      await this.redis.setex(cacheKey, config.redis.ttl.flightSearch, JSON.stringify(result))
      
      logger.info('Flight search completed successfully', {
        resultCount: response.data.length,
        cacheKey,
      })

      return result
    } catch (error: any) {
      logger.error('Flight search failed:', {
        error: error.message,
        response: error.response?.data,
        params,
      })
      
      // Handle specific Amadeus errors
      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.')
      } else if (error.response?.status === 400) {
        throw new Error('Invalid search parameters. Please check your input.')
      } else if (error.response?.status === 404) {
        throw new Error('No flights found for the specified criteria.')
      }
      
      throw new Error('Flight search service temporarily unavailable.')
    }
  }

  async getFlightOfferPricing(flightOfferId: string): Promise<any> {
    try {
      const response = await this.client.shopping.flightOffers.pricing.post(
        JSON.stringify({
          data: {
            type: 'flight-offers-pricing',
            flightOffers: [{ id: flightOfferId }],
          },
        })
      )

      return response.data
    } catch (error: any) {
      logger.error('Flight offer pricing failed:', error)
      throw new Error('Unable to get current flight pricing.')
    }
  }

  // Hotel search methods
  async searchHotels(params: HotelSearchParams): Promise<{
    data: HotelOffer[]
    meta: any
  }> {
    try {
      // Generate cache key
      const cacheKey = this.generateHotelCacheKey(params)
      
      // Check cache first
      const cachedResult = await this.redis.get(cacheKey)
      if (cachedResult) {
        logger.info('Hotel search result retrieved from cache', { cacheKey })
        return JSON.parse(cachedResult)
      }

      // Make API request
      logger.info('Searching hotels via Amadeus API', { params })
      
      const response = await this.client.shopping.hotelOffers.get({
        cityCode: params.cityCode,
        checkInDate: params.checkInDate,
        checkOutDate: params.checkOutDate,
        roomQuantity: (params.roomQuantity || 1).toString(),
        adults: (params.adults || 1).toString(),
        radius: params.radius?.toString(),
        radiusUnit: params.radiusUnit,
        paymentPolicy: params.paymentPolicy,
        includedAmenities: params.includedAmenities?.join(','),
        ratings: params.ratings?.join(','),
        priceRange: params.priceRange,
        currency: params.currency || 'USD',
        lang: params.lang || 'EN',
      })

      const result = {
        data: response.data,
        meta: response.meta,
      }

      // Cache the result
      await this.redis.setex(cacheKey, config.redis.ttl.hotelSearch, JSON.stringify(result))
      
      logger.info('Hotel search completed successfully', {
        resultCount: response.data.length,
        cacheKey,
      })

      return result
    } catch (error: any) {
      logger.error('Hotel search failed:', {
        error: error.message,
        response: error.response?.data,
        params,
      })
      
      // Handle specific Amadeus errors
      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.')
      } else if (error.response?.status === 400) {
        throw new Error('Invalid search parameters. Please check your input.')
      } else if (error.response?.status === 404) {
        throw new Error('No hotels found for the specified criteria.')
      }
      
      throw new Error('Hotel search service temporarily unavailable.')
    }
  }

  async getHotelOfferDetails(offerId: string): Promise<any> {
    try {
      const response = await this.client.shopping.hotelOffer(offerId).get()
      return response.data
    } catch (error: any) {
      logger.error('Hotel offer details failed:', error)
      throw new Error('Unable to get hotel offer details.')
    }
  }

  // Location and reference data methods
  async searchAirports(keyword: string, subType?: string): Promise<any> {
    try {
      const cacheKey = `airport_search:${keyword}:${subType || 'all'}`
      
      // Check cache first
      const cachedResult = await this.redis.get(cacheKey)
      if (cachedResult) {
        return JSON.parse(cachedResult)
      }

      const response = await this.client.referenceData.locations.get({
        keyword,
        subType: subType || 'AIRPORT',
        'page[limit]': '10',
      })

      // Cache for 24 hours
      await this.redis.setex(cacheKey, config.redis.ttl.locationSearch, JSON.stringify(response.data))
      
      return response.data
    } catch (error: any) {
      logger.error('Airport search failed:', error)
      throw new Error('Airport search service temporarily unavailable.')
    }
  }

  async searchCities(keyword: string): Promise<any> {
    try {
      const cacheKey = `city_search:${keyword}`
      
      // Check cache first
      const cachedResult = await this.redis.get(cacheKey)
      if (cachedResult) {
        return JSON.parse(cachedResult)
      }

      const response = await this.client.referenceData.locations.get({
        keyword,
        subType: 'CITY',
        'page[limit]': '10',
      })

      // Cache for 24 hours
      await this.redis.setex(cacheKey, config.redis.ttl.locationSearch, JSON.stringify(response.data))
      
      return response.data
    } catch (error: any) {
      logger.error('City search failed:', error)
      throw new Error('City search service temporarily unavailable.')
    }
  }

  // Utility methods
  private generateFlightCacheKey(params: FlightSearchParams): string {
    const key = `flight_search:${params.originLocationCode}:${params.destinationLocationCode}:${params.departureDate}:${params.returnDate || 'oneway'}:${params.adults}:${params.children || 0}:${params.infants || 0}:${params.travelClass || 'ECONOMY'}`
    return key.toLowerCase()
  }

  private generateHotelCacheKey(params: HotelSearchParams): string {
    const key = `hotel_search:${params.cityCode}:${params.checkInDate}:${params.checkOutDate}:${params.roomQuantity || 1}:${params.adults || 1}`
    return key.toLowerCase()
  }

  // Price monitoring methods
  async monitorFlightPrice(flightOfferId: string, userId: string, threshold: number): Promise<void> {
    try {
      const monitorKey = `price_monitor:flight:${flightOfferId}:${userId}`
      const monitorData = {
        userId,
        flightOfferId,
        threshold,
        createdAt: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
      }

      await this.redis.setex(monitorKey, 86400 * 7, JSON.stringify(monitorData)) // 7 days
      
      logger.info('Flight price monitoring enabled', { flightOfferId, userId, threshold })
    } catch (error: any) {
      logger.error('Failed to set up flight price monitoring:', error)
      throw new Error('Unable to set up price monitoring.')
    }
  }

  async monitorHotelPrice(hotelOfferId: string, userId: string, threshold: number): Promise<void> {
    try {
      const monitorKey = `price_monitor:hotel:${hotelOfferId}:${userId}`
      const monitorData = {
        userId,
        hotelOfferId,
        threshold,
        createdAt: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
      }

      await this.redis.setex(monitorKey, 86400 * 7, JSON.stringify(monitorData)) // 7 days
      
      logger.info('Hotel price monitoring enabled', { hotelOfferId, userId, threshold })
    } catch (error: any) {
      logger.error('Failed to set up hotel price monitoring:', error)
      throw new Error('Unable to set up price monitoring.')
    }
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      // Simple API call to check if service is available
      await this.client.referenceData.locations.get({
        keyword: 'LON',
        subType: 'AIRPORT',
        'page[limit]': '1',
      })
      
      return true
    } catch (error) {
      logger.error('Amadeus health check failed:', error)
      return false
    }
  }
}

export default AmadeusService