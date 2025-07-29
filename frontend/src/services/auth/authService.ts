import axios from 'axios'
import { User, APIResponse } from '@types/index'

// Constants
const TOKEN_KEY = 'travel_planner_token'
const REFRESH_TOKEN_KEY = 'travel_planner_refresh_token'
const USER_KEY = 'travel_planner_user'

class AuthService {
  private baseURL: string

  constructor() {
    this.baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1'
  }

  // Token management
  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token)
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  }

  setRefreshToken(refreshToken: string): void {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY)
  }

  clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  // User data management
  setUser(user: User): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }

  getUser(): User | null {
    const userStr = localStorage.getItem(USER_KEY)
    return userStr ? JSON.parse(userStr) : null
  }

  // API calls
  async login(credentials: { email: string; password: string }): Promise<APIResponse<{
    accessToken: string
    refreshToken: string
    expiresIn: number
    user: User
  }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/login`, credentials)
      
      if (response.data.success && response.data.data) {
        const { user, accessToken, refreshToken } = response.data.data
        this.setUser(user)
        this.setToken(accessToken)
        this.setRefreshToken(refreshToken)
      }
      
      return response.data
    } catch (error: any) {
      throw new Error(error.response?.data?.error?.message || 'Login failed')
    }
  }

  async register(userData: {
    email: string
    password: string
    firstName: string
    lastName: string
  }): Promise<APIResponse<{
    userId: string
    email: string
    firstName: string
    lastName: string
    verificationRequired: boolean
    verificationEmailSent: boolean
  }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/register`, userData)
      return response.data
    } catch (error: any) {
      throw new Error(error.response?.data?.error?.message || 'Registration failed')
    }
  }

  async refreshToken(refreshToken: string): Promise<APIResponse<{
    accessToken: string
    expiresIn: number
  }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/refresh`, {
        refreshToken
      })
      
      if (response.data.success && response.data.data) {
        this.setToken(response.data.data.accessToken)
      }
      
      return response.data
    } catch (error: any) {
      this.clearTokens()
      throw new Error(error.response?.data?.error?.message || 'Token refresh failed')
    }
  }

  async logout(refreshToken: string): Promise<APIResponse<null>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/logout`, {
        refreshToken
      }, {
        headers: {
          Authorization: `Bearer ${this.getToken()}`
        }
      })
      
      this.clearTokens()
      return response.data
    } catch (error: any) {
      this.clearTokens()
      throw new Error(error.response?.data?.error?.message || 'Logout failed')
    }
  }

  async getCurrentUser(): Promise<User> {
    try {
      const token = this.getToken()
      if (!token) {
        throw new Error('No authentication token found')
      }

      const response = await axios.get(`${this.baseURL}/users/profile`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      if (response.data.success && response.data.data) {
        const user = response.data.data
        this.setUser(user)
        return user
      }

      throw new Error('Failed to get user profile')
    } catch (error: any) {
      this.clearTokens()
      throw new Error(error.response?.data?.error?.message || 'Failed to get current user')
    }
  }

  async forgotPassword(email: string): Promise<APIResponse<{ message: string }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/forgot-password`, {
        email
      })
      return response.data
    } catch (error: any) {
      throw new Error(error.response?.data?.error?.message || 'Password reset request failed')
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<APIResponse<{ message: string }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/reset-password`, {
        token,
        newPassword
      })
      return response.data
    } catch (error: any) {
      throw new Error(error.response?.data?.error?.message || 'Password reset failed')
    }
  }

  async verifyEmail(token: string): Promise<APIResponse<{ message: string }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/verify-email`, {
        token
      })
      return response.data
    } catch (error: any) {
      throw new Error(error.response?.data?.error?.message || 'Email verification failed')
    }
  }

  async resendVerificationEmail(email: string): Promise<APIResponse<{ message: string }>> {
    try {
      const response = await axios.post(`${this.baseURL}/auth/resend-verification`, {
        email
      })
      return response.data
    } catch (error: any) {
      throw new Error(error.response?.data?.error?.message || 'Failed to resend verification email')
    }
  }

  // Utility methods
  isAuthenticated(): boolean {
    const token = this.getToken()
    if (!token) return false

    try {
      // Check if token is expired (simple check)
      const payload = JSON.parse(atob(token.split('.')[1]))
      const currentTime = Date.now() / 1000
      
      return payload.exp > currentTime
    } catch (error) {
      return false
    }
  }

  isTokenExpired(token?: string): boolean {
    const authToken = token || this.getToken()
    if (!authToken) return true

    try {
      const payload = JSON.parse(atob(authToken.split('.')[1]))
      const currentTime = Date.now() / 1000
      
      return payload.exp <= currentTime
    } catch (error) {
      return true
    }
  }

  getTokenExpirationTime(): number | null {
    const token = this.getToken()
    if (!token) return null

    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      return payload.exp * 1000 // Convert to milliseconds
    } catch (error) {
      return null
    }
  }

  // Setup axios interceptors for automatic token refresh
  setupAxiosInterceptors(): void {
    axios.interceptors.request.use((config) => {
      const token = this.getToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    })

    axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true

          try {
            const refreshToken = this.getRefreshToken()
            if (refreshToken) {
              await this.refreshToken(refreshToken)
              
              // Retry the original request with new token
              const newToken = this.getToken()
              if (newToken) {
                originalRequest.headers.Authorization = `Bearer ${newToken}`
                return axios(originalRequest)
              }
            }
          } catch (refreshError) {
            // Refresh failed, redirect to login
            this.clearTokens()
            window.location.href = '/auth/login'
          }
        }

        return Promise.reject(error)
      }
    )
  }
}

// Export singleton instance
export const authService = new AuthService()

// Initialize axios interceptors
authService.setupAxiosInterceptors()

export default authService