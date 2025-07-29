import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { apiSlice } from './apiSlice'
import { AuthState, User, APIResponse } from '@types/index'
import { authService } from '@services/auth/authService'
import { toast } from 'react-hot-toast'

// Initial state
const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  token: null,
  refreshToken: null,
  loading: false,
  error: null,
}

// Async thunks
export const initializeAuth = createAsyncThunk(
  'auth/initializeAuth',
  async (_, { rejectWithValue }) => {
    try {
      const token = authService.getToken()
      const refreshToken = authService.getRefreshToken()
      
      if (token && refreshToken) {
        const user = await authService.getCurrentUser()
        return { user, token, refreshToken }
      }
      
      return null
    } catch (error: any) {
      return rejectWithValue(error.message)
    }
  }
)

export const loginUser = createAsyncThunk(
  'auth/loginUser',
  async (
    credentials: { email: string; password: string },
    { rejectWithValue }
  ) => {
    try {
      const response = await authService.login(credentials)
      
      // Store tokens securely
      authService.setToken(response.data.accessToken)
      authService.setRefreshToken(response.data.refreshToken)
      
      toast.success('Welcome back!')
      return response.data
    } catch (error: any) {
      toast.error(error.message || 'Login failed')
      return rejectWithValue(error.message)
    }
  }
)

export const registerUser = createAsyncThunk(
  'auth/registerUser',
  async (
    userData: {
      email: string
      password: string
      firstName: string
      lastName: string
    },
    { rejectWithValue }
  ) => {
    try {
      const response = await authService.register(userData)
      toast.success('Registration successful! Please verify your email.')
      return response.data
    } catch (error: any) {
      toast.error(error.message || 'Registration failed')
      return rejectWithValue(error.message)
    }
  }
)

export const logoutUser = createAsyncThunk(
  'auth/logoutUser',
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as { auth: AuthState }
      const refreshToken = state.auth.refreshToken
      
      if (refreshToken) {
        await authService.logout(refreshToken)
      }
      
      // Clear stored tokens
      authService.clearTokens()
      
      toast.success('Logged out successfully')
      return null
    } catch (error: any) {
      // Even if logout API fails, clear local tokens
      authService.clearTokens()
      return rejectWithValue(error.message)
    }
  }
)

// Auth slice
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload
      authService.setToken(action.payload)
    },
    
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload
    },
    
    clearError: (state) => {
      state.error = null
    },
    
    logout: (state) => {
      state.isAuthenticated = false
      state.user = null
      state.token = null
      state.refreshToken = null
      state.error = null
      authService.clearTokens()
    },
  },
  extraReducers: (builder) => {
    // Initialize auth
    builder
      .addCase(initializeAuth.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(initializeAuth.fulfilled, (state, action) => {
        state.loading = false
        if (action.payload) {
          state.isAuthenticated = true
          state.user = action.payload.user
          state.token = action.payload.token
          state.refreshToken = action.payload.refreshToken
        }
      })
      .addCase(initializeAuth.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload as string
        // Clear potentially invalid tokens
        authService.clearTokens()
      })

    // Login
    builder
      .addCase(loginUser.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.loading = false
        state.isAuthenticated = true
        state.user = action.payload.user
        state.token = action.payload.accessToken
        state.refreshToken = action.payload.refreshToken
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload as string
        state.isAuthenticated = false
      })

    // Register
    builder
      .addCase(registerUser.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(registerUser.fulfilled, (state, action) => {
        state.loading = false
        // Don't auto-login after registration - user needs to verify email
        if (action.payload.verificationRequired) {
          state.isAuthenticated = false
        } else {
          state.isAuthenticated = true
          state.user = action.payload.user
          state.token = action.payload.accessToken
          state.refreshToken = action.payload.refreshToken
        }
      })
      .addCase(registerUser.rejected, (state, action) => {
        state.loading = false
        state.error = action.payload as string
      })

    // Logout
    builder
      .addCase(logoutUser.pending, (state) => {
        state.loading = true
      })
      .addCase(logoutUser.fulfilled, (state) => {
        state.loading = false
        state.isAuthenticated = false
        state.user = null
        state.token = null
        state.refreshToken = null
        state.error = null
      })
      .addCase(logoutUser.rejected, (state, action) => {
        state.loading = false
        // Still logout locally even if API call failed
        state.isAuthenticated = false
        state.user = null
        state.token = null
        state.refreshToken = null
      })
  },
})

// Inject auth endpoints into API slice
export const authApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation<
      APIResponse<{
        accessToken: string
        refreshToken: string
        expiresIn: number
        user: User
      }>,
      { email: string; password: string }
    >({
      query: (credentials) => ({
        url: '/auth/login',
        method: 'POST',
        body: credentials,
      }),
      invalidatesTags: ['User'],
    }),
    
    register: builder.mutation<
      APIResponse<{
        userId: string
        email: string
        firstName: string
        lastName: string
        verificationRequired: boolean
        verificationEmailSent: boolean
      }>,
      {
        email: string
        password: string
        firstName: string
        lastName: string
      }
    >({
      query: (userData) => ({
        url: '/auth/register',
        method: 'POST',
        body: userData,
      }),
    }),
    
    refreshToken: builder.mutation<
      APIResponse<{
        accessToken: string
        expiresIn: number
      }>,
      { refreshToken: string }
    >({
      query: (data) => ({
        url: '/auth/refresh',
        method: 'POST',
        body: data,
      }),
    }),
    
    logout: builder.mutation<
      APIResponse<null>,
      { refreshToken: string }
    >({
      query: (data) => ({
        url: '/auth/logout',
        method: 'POST',
        body: data,
      }),
      invalidatesTags: ['User', 'Itinerary', 'Notification'],
    }),
  }),
})

// Export actions
export const { setToken, setUser, clearError, logout } = authSlice.actions

// Export selectors
export const selectAuth = (state: { auth: AuthState }) => state.auth
export const selectIsAuthenticated = (state: { auth: AuthState }) => state.auth.isAuthenticated
export const selectCurrentUser = (state: { auth: AuthState }) => state.auth.user
export const selectAuthLoading = (state: { auth: AuthState }) => state.auth.loading
export const selectAuthError = (state: { auth: AuthState }) => state.auth.error

export default authSlice.reducer