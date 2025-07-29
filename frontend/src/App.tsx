import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { Box, CircularProgress } from '@mui/material'
import { Helmet } from 'react-helmet-async'

import { RootState } from '@types/index'
import { initializeAuth } from '@store/slices/authSlice'
import { connectWebSocket } from '@services/websocket'

// Layout components
import MainLayout from '@components/layouts/MainLayout'
import AuthLayout from '@components/layouts/AuthLayout'

// Page components
import HomePage from '@pages/Home/HomePage'
import SearchPage from '@pages/Search/SearchPage'
import ResultsPage from '@pages/Results/ResultsPage'
import ItineraryPage from '@pages/Itinerary/ItineraryPage'
import ProfilePage from '@pages/Profile/ProfilePage'
import LoginPage from '@pages/Auth/LoginPage'
import RegisterPage from '@pages/Auth/RegisterPage'

// Protected route component
import ProtectedRoute from '@components/common/ProtectedRoute'
import ErrorBoundary from '@components/common/ErrorBoundary'

function App() {
  const dispatch = useDispatch()
  const { isAuthenticated, loading, user } = useSelector((state: RootState) => state.auth)

  useEffect(() => {
    // Initialize authentication on app startup
    dispatch(initializeAuth())
  }, [dispatch])

  useEffect(() => {
    // Connect to WebSocket for real-time updates when authenticated
    if (isAuthenticated && user) {
      connectWebSocket(user.userId)
    }
  }, [isAuthenticated, user])

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        bgcolor="background.default"
      >
        <CircularProgress size={60} />
      </Box>
    )
  }

  return (
    <ErrorBoundary>
      <Helmet>
        <title>Travel Itinerary Planner - AI-Powered Trip Planning</title>
        <meta 
          name="description" 
          content="Plan your perfect trip with AI-powered itinerary generation, real-time flight and hotel search, and personalized recommendations." 
        />
        <meta name="keywords" content="travel, itinerary, planning, AI, flights, hotels, vacation, trip" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="canonical" href="https://travel-planner.com" />
      </Helmet>

      <Routes>
        {/* Public routes with auth layout */}
        <Route path="/auth" element={<AuthLayout />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
          <Route index element={<Navigate to="/auth/login" replace />} />
        </Route>

        {/* Main application routes */}
        <Route path="/" element={<MainLayout />}>
          {/* Public routes */}
          <Route index element={<HomePage />} />
          
          {/* Protected routes */}
          <Route 
            path="search" 
            element={
              <ProtectedRoute>
                <SearchPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="results" 
            element={
              <ProtectedRoute>
                <ResultsPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="itinerary/:id?" 
            element={
              <ProtectedRoute>
                <ItineraryPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="profile" 
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            } 
          />
        </Route>

        {/* Catch-all redirect */}
        <Route 
          path="*" 
          element={
            isAuthenticated ? (
              <Navigate to="/" replace />
            ) : (
              <Navigate to="/auth/login" replace />
            )
          } 
        />
      </Routes>
    </ErrorBoundary>
  )
}

export default App