import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query'

import type { RootState } from '@types/index'
import { logout } from './authSlice'

// Base query with authentication
const baseQuery = fetchBaseQuery({
  baseUrl: '/api/v1',
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.token
    
    if (token) {
      headers.set('authorization', `Bearer ${token}`)
    }
    
    headers.set('content-type', 'application/json')
    return headers
  },
})

// Base query with re-authentication
const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await baseQuery(args, api, extraOptions)

  if (result.error && result.error.status === 401) {
    // Try to get a new token using refresh token
    const refreshToken = (api.getState() as RootState).auth.refreshToken
    
    if (refreshToken) {
      const refreshResult = await baseQuery(
        {
          url: '/auth/refresh',
          method: 'POST',
          body: { refreshToken },
        },
        api,
        extraOptions
      )

      if (refreshResult.data) {
        // Store the new token and retry the original query
        const { accessToken } = refreshResult.data as { accessToken: string }
        api.dispatch({ type: 'auth/setToken', payload: accessToken })
        result = await baseQuery(args, api, extraOptions)
      } else {
        // Refresh failed, logout user
        api.dispatch(logout())
      }
    } else {
      // No refresh token, logout user
      api.dispatch(logout())
    }
  }

  return result
}

// API slice with RTK Query
export const apiSlice = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithReauth,
  tagTypes: [
    'User',
    'Itinerary',
    'Flight',
    'Hotel',
    'Search',
    'Notification',
    'Booking'
  ],
  endpoints: () => ({}), // Endpoints will be injected in feature slices
})

// Export hooks
export const {
  // Auth endpoints will be injected
  useLoginMutation,
  useRegisterMutation,
  useRefreshTokenMutation,
  useLogoutMutation,
  
  // User endpoints will be injected
  useGetUserProfileQuery,
  useUpdateUserProfileMutation,
  useGetUserPreferencesQuery,
  useUpdateUserPreferencesMutation,
  
  // Search endpoints will be injected
  useSearchFlightsMutation,
  useSearchHotelsMutation,
  useGetLocationSuggestionsQuery,
  
  // Itinerary endpoints will be injected
  useGenerateItineraryMutation,
  useGetItineraryQuery,
  useUpdateItineraryMutation,
  useDeleteItineraryMutation,
  useShareItineraryMutation,
  useGetUserItinerariesQuery,
  
  // Notification endpoints will be injected
  useGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useCreatePriceAlertMutation,
  useSendItineraryEmailMutation,
} = apiSlice as any // Type assertion for injected endpoints