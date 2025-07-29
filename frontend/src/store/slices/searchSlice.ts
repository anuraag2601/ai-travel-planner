import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { apiSlice } from './apiSlice'
import { 
  SearchState, 
  FlightSearchParams, 
  FlightResult, 
  HotelSearchParams, 
  HotelResult,
  LocationSuggestion,
  APIResponse 
} from '@types/index'

// Initial state
const initialState: SearchState = {
  flights: {
    params: null,
    results: [],
    loading: false,
    error: null,
    totalResults: 0,
    filters: {
      priceRange: { min: 0, max: 10000 },
      airlines: [],
      stops: [],
      departureTimeRanges: {}
    },
  },
  hotels: {
    params: null,
    results: [],
    loading: false,
    error: null,
    totalResults: 0,
    filters: {
      priceRange: { min: 0, max: 1000 },
      starRating: [],
      amenities: [],
      propertyTypes: []
    },
  },
  locations: {
    suggestions: [],
    loading: false,
    error: null,
  },
}

// Search slice
const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    // Flight search reducers
    setFlightSearchParams: (state, action: PayloadAction<FlightSearchParams>) => {
      state.flights.params = action.payload
    },
    
    clearFlightResults: (state) => {
      state.flights.results = []
      state.flights.totalResults = 0
      state.flights.error = null
    },
    
    setFlightFilters: (state, action: PayloadAction<any>) => {
      state.flights.filters = { ...state.flights.filters, ...action.payload }
    },
    
    // Hotel search reducers
    setHotelSearchParams: (state, action: PayloadAction<HotelSearchParams>) => {
      state.hotels.params = action.payload
    },
    
    clearHotelResults: (state) => {
      state.hotels.results = []
      state.hotels.totalResults = 0
      state.hotels.error = null
    },
    
    setHotelFilters: (state, action: PayloadAction<any>) => {
      state.hotels.filters = { ...state.hotels.filters, ...action.payload }
    },
    
    // Location search reducers
    clearLocationSuggestions: (state) => {
      state.locations.suggestions = []
      state.locations.error = null
    },
    
    // General reducers
    clearSearchErrors: (state) => {
      state.flights.error = null
      state.hotels.error = null
      state.locations.error = null
    },
  },
})

// Inject search endpoints into API slice
export const searchApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    searchFlights: builder.mutation<
      APIResponse<{
        searchId: string
        results: FlightResult[]
        totalResults: number
        pagination: {
          page: number
          perPage: number
          totalPages: number
        }
        filters: any
      }>,
      FlightSearchParams
    >({
      query: (params) => ({
        url: '/search/flights',
        method: 'POST',
        body: params,
      }),
      providesTags: ['Flight'],
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        dispatch(setFlightSearchParams(arg))
        try {
          const { data } = await queryFulfilled
          if (data.success && data.data) {
            // Update filters based on search results
            dispatch(setFlightFilters(data.data.filters))
          }
        } catch (error) {
          console.error('Flight search failed:', error)
        }
      },
    }),
    
    searchHotels: builder.mutation<
      APIResponse<{
        searchId: string
        results: HotelResult[]
        totalResults: number
        pagination: {
          page: number
          perPage: number
          totalPages: number
        }
      }>,
      HotelSearchParams
    >({
      query: (params) => ({
        url: '/search/hotels',
        method: 'POST',
        body: params,
      }),
      providesTags: ['Hotel'],
      async onQueryStarted(arg, { dispatch, queryFulfilled }) {
        dispatch(setHotelSearchParams(arg))
        try {
          await queryFulfilled
        } catch (error) {
          console.error('Hotel search failed:', error)
        }
      },
    }),
    
    getLocationSuggestions: builder.query<
      APIResponse<LocationSuggestion[]>,
      { query: string; type?: 'city' | 'airport' | 'all'; limit?: number }
    >({
      query: ({ query, type = 'all', limit = 10 }) => ({
        url: '/search/locations',
        params: { q: query, type, limit },
      }),
      keepUnusedDataFor: 300, // Keep cached for 5 minutes
    }),
    
    // Get cached search results
    getCachedFlightSearch: builder.query<
      APIResponse<{
        results: FlightResult[]
        searchParams: FlightSearchParams
        totalResults: number
      }>,
      string
    >({
      query: (searchId) => ({
        url: `/search/flights/${searchId}`,
      }),
      providesTags: ['Flight'],
    }),
    
    getCachedHotelSearch: builder.query<
      APIResponse<{
        results: HotelResult[]
        searchParams: HotelSearchParams
        totalResults: number
      }>,
      string
    >({
      query: (searchId) => ({
        url: `/search/hotels/${searchId}`,
      }),
      providesTags: ['Hotel'],
    }),
    
    // Get search history
    getSearchHistory: builder.query<
      APIResponse<Array<{
        id: string
        type: 'flight' | 'hotel'
        params: FlightSearchParams | HotelSearchParams
        createdAt: string
        resultCount: number
      }>>,
      { limit?: number; type?: 'flight' | 'hotel' | 'all' }
    >({
      query: ({ limit = 20, type = 'all' }) => ({
        url: '/search/history',
        params: { limit, type },
      }),
      providesTags: ['Search'],
    }),
  }),
})

// Export actions
export const {
  setFlightSearchParams,
  clearFlightResults,
  setFlightFilters,
  setHotelSearchParams,
  clearHotelResults,
  setHotelFilters,
  clearLocationSuggestions,
  clearSearchErrors,
} = searchSlice.actions

// Export selectors
export const selectFlightSearch = (state: { search: SearchState }) => state.search.flights
export const selectHotelSearch = (state: { search: SearchState }) => state.search.hotels
export const selectLocationSearch = (state: { search: SearchState }) => state.search.locations
export const selectSearchLoading = (state: { search: SearchState }) => 
  state.search.flights.loading || state.search.hotels.loading
export const selectSearchErrors = (state: { search: SearchState }) => ({
  flights: state.search.flights.error,
  hotels: state.search.hotels.error,
  locations: state.search.locations.error,
})

// Filter selectors
export const selectFilteredFlights = (state: { search: SearchState }) => {
  const { results, filters } = state.search.flights
  
  return results.filter(flight => {
    const price = flight.totalPrice.amount
    const { priceRange, airlines, stops } = filters
    
    // Price filter
    if (price < priceRange.min || price > priceRange.max) {
      return false
    }
    
    // Airline filter
    if (airlines.length > 0 && !airlines.includes(flight.outbound.airline)) {
      return false
    }
    
    // Stops filter
    if (stops.length > 0 && !stops.includes(flight.outbound.stops)) {
      return false
    }
    
    return true
  })
}

export const selectFilteredHotels = (state: { search: SearchState }) => {
  const { results, filters } = state.search.hotels
  
  return results.filter(hotel => {
    const price = hotel.totalPrice.pricePerNight
    const { priceRange, starRating, amenities, propertyTypes } = filters
    
    // Price filter
    if (price < priceRange.min || price > priceRange.max) {
      return false
    }
    
    // Star rating filter
    if (starRating.length > 0 && !starRating.includes(hotel.starRating)) {
      return false
    }
    
    // Amenities filter
    if (amenities.length > 0) {
      const hasRequiredAmenities = amenities.every(amenity => 
        hotel.hotelAmenities.includes(amenity)
      )
      if (!hasRequiredAmenities) {
        return false
      }
    }
    
    return true
  })
}

export default searchSlice.reducer