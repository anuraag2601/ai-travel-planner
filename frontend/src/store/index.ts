import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'

// Slice imports
import authSlice from './slices/authSlice'
import userSlice from './slices/userSlice'
import searchSlice from './slices/searchSlice'
import itinerarySlice from './slices/itinerarySlice'
import notificationSlice from './slices/notificationSlice'
import uiSlice from './slices/uiSlice'

// API slice imports
import { apiSlice } from './slices/apiSlice'

// Middleware imports
import { authMiddleware } from './middleware/authMiddleware'
import { errorMiddleware } from './middleware/errorMiddleware'
import { analyticsMiddleware } from './middleware/analyticsMiddleware'

export const store = configureStore({
  reducer: {
    // API slice
    api: apiSlice.reducer,
    
    // Feature slices
    auth: authSlice,
    user: userSlice,
    search: searchSlice,
    itinerary: itinerarySlice,
    notifications: notificationSlice,
    ui: uiSlice,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [
          'persist/PERSIST',
          'persist/REHYDRATE',
          'persist/REGISTER',
        ],
      },
    })
      .concat(apiSlice.middleware)
      .concat(authMiddleware)
      .concat(errorMiddleware)
      .concat(analyticsMiddleware),
  devTools: import.meta.env.DEV,
})

// Setup RTK Query listeners
setupListeners(store.dispatch)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

// Export action creators
export { authSlice, userSlice, searchSlice, itinerarySlice, notificationSlice, uiSlice }

export default store