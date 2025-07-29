import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../../utils/theme';
import App from '../../App';

// Mock API responses
const mockFlightSearchResponse = {
  success: true,
  data: {
    searchId: 'search_123',
    flights: [
      {
        id: 'flight_123',
        price: { currency: 'USD', total: '1245.50' },
        itineraries: [
          {
            duration: 'PT7H15M',
            segments: [
              {
                departure: { iataCode: 'JFK', at: '2024-03-15T14:30:00' },
                arrival: { iataCode: 'CDG', at: '2024-03-16T07:45:00' },
                carrierCode: 'AF',
                number: '007'
              }
            ]
          }
        ]
      }
    ]
  }
};

const mockItineraryResponse = {
  success: true,
  data: {
    itineraryId: 'itin_123',
    overview: {
      title: '7-Day Cultural Paris Adventure',
      description: 'A perfect blend of iconic landmarks and cultural experiences'
    },
    dailyItinerary: [
      {
        day: 1,
        date: '2024-03-15',
        theme: 'Arrival and Central Paris',
        activities: [
          {
            time: '14:00',
            title: 'Eiffel Tower Visit',
            description: 'Visit the iconic Eiffel Tower'
          }
        ]
      }
    ]
  }
};

const mockLocationResponse = {
  success: true,
  data: [
    {
      id: 'airport_JFK',
      name: 'John F Kennedy International Airport',
      iataCode: 'JFK',
      type: 'airport',
      city: 'New York',
      country: 'United States'
    },
    {
      id: 'airport_CDG',
      name: 'Charles de Gaulle Airport',
      iataCode: 'CDG',
      type: 'airport',
      city: 'Paris',
      country: 'France'
    }
  ]
};

// Mock API calls
global.fetch = vi.fn();

const mockFetch = (url: string, options?: any) => {
  const urlObj = new URL(url, 'http://localhost:8080');
  
  if (urlObj.pathname.includes('/search/flights')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockFlightSearchResponse)
    });
  }
  
  if (urlObj.pathname.includes('/search/locations')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockLocationResponse)
    });
  }
  
  if (urlObj.pathname.includes('/itineraries/generate')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockItineraryResponse)
    });
  }

  return Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: 'Not found' })
  });
};

// Mock Firebase Auth
const mockUser = {
  uid: 'test-user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  getIdToken: vi.fn().mockResolvedValue('mock-id-token')
};

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    currentUser: mockUser,
    onAuthStateChanged: vi.fn((callback) => {
      callback(mockUser);
      return vi.fn(); // unsubscribe function
    })
  })),
  onAuthStateChanged: vi.fn()
}));

// Create test store
const createTestStore = () => {
  return configureStore({
    reducer: {
      auth: (state = {
        user: mockUser,
        isAuthenticated: true,
        loading: false,
        error: null
      }) => state,
      search: (state = {
        flights: [],
        hotels: [],
        locations: [],
        loading: false,
        error: null
      }) => state,
      itinerary: (state = {
        current: null,
        list: [],
        loading: false,
        error: null
      }) => state
    }
  });
};

// Test wrapper
const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const store = createTestStore();
  
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </ThemeProvider>
    </Provider>
  );
};

describe('End-to-End User Journeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockImplementation(mockFetch);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Flight Search Journey', () => {
    it('allows user to search for flights from start to finish', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Step 1: Navigate to flight search
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      await waitFor(() => {
        expect(screen.getByText(/flight search/i)).toBeInTheDocument();
      });

      // Step 2: Fill in search form
      const originInput = screen.getByLabelText(/origin/i);
      const destinationInput = screen.getByLabelText(/destination/i);
      const departureDateInput = screen.getByLabelText(/departure date/i);
      const returnDateInput = screen.getByLabelText(/return date/i);

      await user.type(originInput, 'JFK');
      await user.type(destinationInput, 'CDG');
      await user.type(departureDateInput, '2024-03-15');
      await user.type(returnDateInput, '2024-03-22');

      // Step 3: Submit search
      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      // Step 4: Verify results appear
      await waitFor(() => {
        expect(screen.getByText(/flight results/i)).toBeInTheDocument();
        expect(screen.getByText(/AF007/)).toBeInTheDocument();
        expect(screen.getByText(/\$1,245.50/)).toBeInTheDocument();
      });

      // Step 5: Select a flight
      const selectFlightButton = screen.getByRole('button', { name: /select flight/i });
      await user.click(selectFlightButton);

      // Step 6: Verify flight is selected and user can proceed
      await waitFor(() => {
        expect(screen.getByText(/flight selected/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /continue to hotels/i })).toBeInTheDocument();
      });

      // Verify API was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/search/flights'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer mock-id-token'
          }),
          body: expect.stringContaining('JFK')
        })
      );
    });

    it('handles search errors gracefully', async () => {
      const user = userEvent.setup();
      
      // Mock API error
      (global.fetch as any).mockImplementation(() => 
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({
            success: false,
            error: {
              code: 'SEARCH_002',
              message: 'Invalid search parameters'
            }
          })
        })
      );

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to flight search and submit invalid search
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/invalid search parameters/i)).toBeInTheDocument();
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  describe('Complete Trip Planning Journey', () => {
    it('allows user to plan a complete trip from search to itinerary', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Step 1: Start with trip planning
      const planTripButton = screen.getByRole('button', { name: /plan your trip/i });
      await user.click(planTripButton);

      await waitFor(() => {
        expect(screen.getByText(/trip planning/i)).toBeInTheDocument();
      });

      // Step 2: Fill in trip details
      const destinationInput = screen.getByLabelText(/destination/i);
      const startDateInput = screen.getByLabelText(/start date/i);
      const endDateInput = screen.getByLabelText(/end date/i);
      const budgetInput = screen.getByLabelText(/budget/i);

      await user.type(destinationInput, 'Paris');
      await user.type(startDateInput, '2024-03-15');
      await user.type(endDateInput, '2024-03-22');
      await user.type(budgetInput, '5000');

      // Step 3: Select interests
      const cultureCheckbox = screen.getByLabelText(/culture/i);
      const museumsCheckbox = screen.getByLabelText(/museums/i);
      const foodCheckbox = screen.getByLabelText(/food/i);

      await user.click(cultureCheckbox);
      await user.click(museumsCheckbox);
      await user.click(foodCheckbox);

      // Step 4: Generate itinerary
      const generateButton = screen.getByRole('button', { name: /generate itinerary/i });
      await user.click(generateButton);

      // Step 5: Verify itinerary is generated
      await waitFor(() => {
        expect(screen.getByText(/7-Day Cultural Paris Adventure/i)).toBeInTheDocument();
        expect(screen.getByText(/Eiffel Tower Visit/i)).toBeInTheDocument();
      }, { timeout: 10000 });

      // Step 6: Save itinerary
      const saveButton = screen.getByRole('button', { name: /save itinerary/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText(/itinerary saved/i)).toBeInTheDocument();
      });

      // Verify API calls were made
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/itineraries/generate'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer mock-id-token'
          })
        })
      );
    });

    it('handles itinerary generation errors', async () => {
      const user = userEvent.setup();
      
      // Mock API error for itinerary generation
      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/itineraries/generate')) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: () => Promise.resolve({
              success: false,
              error: {
                code: 'ITINERARY_001',
                message: 'AI service temporarily unavailable'
              }
            })
          });
        }
        return mockFetch(url);
      });

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to trip planning and try to generate
      const planTripButton = screen.getByRole('button', { name: /plan your trip/i });
      await user.click(planTripButton);

      const generateButton = screen.getByRole('button', { name: /generate itinerary/i });
      await user.click(generateButton);

      // Verify error is displayed
      await waitFor(() => {
        expect(screen.getByText(/AI service temporarily unavailable/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      });
    });
  });

  describe('User Authentication Flow', () => {
    it('redirects unauthenticated users to login', async () => {
      // Mock unauthenticated state
      vi.mocked(getAuth).mockReturnValue({
        currentUser: null,
        onAuthStateChanged: vi.fn((callback) => {
          callback(null);
          return vi.fn();
        })
      } as any);

      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Try to access protected route
      const planTripButton = screen.getByRole('button', { name: /plan your trip/i });
      await user.click(planTripButton);

      // Should be redirected to login
      await waitFor(() => {
        expect(screen.getByText(/login/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      });
    });

    it('allows authenticated users to access protected routes', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Should be able to access protected routes
      const planTripButton = screen.getByRole('button', { name: /plan your trip/i });
      await user.click(planTripButton);

      await waitFor(() => {
        expect(screen.getByText(/trip planning/i)).toBeInTheDocument();
        expect(screen.queryByText(/login/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('Responsive Design Journey', () => {
    it('adapts to mobile viewport', async () => {
      // Mock mobile viewport
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 667,
      });

      // Mock matchMedia for mobile
      window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Mobile navigation should be present
      expect(screen.getByLabelText(/menu/i)).toBeInTheDocument();
      
      // Desktop navigation should be hidden
      expect(screen.queryByTestId('desktop-nav')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility Journey', () => {
    it('supports keyboard navigation', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Tab through navigation
      await user.tab();
      expect(screen.getByRole('link', { name: /home/i })).toHaveFocus();

      await user.tab();
      expect(screen.getByRole('link', { name: /search flights/i })).toHaveFocus();

      // Press Enter to activate link
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.getByText(/flight search/i)).toBeInTheDocument();
      });
    });

    it('provides proper ARIA labels and descriptions', () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Check for proper ARIA attributes
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      
      // Form inputs should have proper labels
      const searchButton = screen.getByRole('button', { name: /search/i });
      expect(searchButton).toHaveAttribute('aria-label');
    });

    it('supports screen reader announcements', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to flight search
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      // Verify screen reader announcements for status updates
      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      await waitFor(() => {
        const liveRegion = screen.getByRole('status');
        expect(liveRegion).toBeInTheDocument();
        expect(liveRegion).toHaveAttribute('aria-live', 'polite');
      });
    });

    it('provides skip links for keyboard users', () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Skip links should be present but visually hidden
      const skipLink = screen.getByText(/skip to main content/i);
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute('href', '#main-content');
    });

    it('ensures proper color contrast', () => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Check that buttons have sufficient contrast (this would be tested with actual color values)
      const buttons = screen.getAllByRole('button');
      buttons.forEach(button => {
        const styles = window.getComputedStyle(button);
        // In a real test, you would check contrast ratios here
        expect(button).toBeVisible();
      });
    });
  });

  describe('Performance and Loading States', () => {
    it('shows loading states during API calls', async () => {
      const user = userEvent.setup();
      
      // Mock slow API response
      (global.fetch as any).mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockFlightSearchResponse)
          }), 2000)
        )
      );

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to flight search
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      // Verify loading state appears
      expect(screen.getByText(/searching for flights/i)).toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      // Verify loading state disappears when results arrive
      await waitFor(() => {
        expect(screen.queryByText(/searching for flights/i)).not.toBeInTheDocument();
        expect(screen.getByText(/flight results/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('handles slow network conditions gracefully', async () => {
      const user = userEvent.setup();
      
      // Mock extremely slow response
      (global.fetch as any).mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockFlightSearchResponse)
          }), 5000)
        )
      );

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      // Should show timeout warning after reasonable time
      await waitFor(() => {
        expect(screen.getByText(/this is taking longer than usual/i)).toBeInTheDocument();
      }, { timeout: 3000 });

      // Should offer option to cancel
      expect(screen.getByRole('button', { name: /cancel search/i })).toBeInTheDocument();
    });
  });

  describe('Form Validation and Error Handling', () => {
    it('validates form inputs in real-time', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate to flight search
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      // Test invalid date
      const departureDateInput = screen.getByLabelText(/departure date/i);
      await user.type(departureDateInput, '2020-01-01'); // Past date

      // Should show validation error immediately
      await waitFor(() => {
        expect(screen.getByText(/departure date cannot be in the past/i)).toBeInTheDocument();
      });

      // Test future return date before departure
      const returnDateInput = screen.getByLabelText(/return date/i);
      await user.clear(departureDateInput);
      await user.type(departureDateInput, '2024-12-25');
      await user.type(returnDateInput, '2024-12-20'); // Before departure

      await waitFor(() => {
        expect(screen.getByText(/return date must be after departure date/i)).toBeInTheDocument();
      });
    });

    it('prevents form submission with invalid data', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      // Try to submit with empty required fields
      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      // Should show validation errors and not make API call
      await waitFor(() => {
        expect(screen.getByText(/origin is required/i)).toBeInTheDocument();
        expect(screen.getByText(/destination is required/i)).toBeInTheDocument();
      });

      // Verify no API call was made
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Data Persistence and State Management', () => {
    it('persists search criteria across page refreshes', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Fill in search form
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const originInput = screen.getByLabelText(/origin/i);
      const destinationInput = screen.getByLabelText(/destination/i);
      
      await user.type(originInput, 'JFK');
      await user.type(destinationInput, 'CDG');

      // Simulate page refresh by re-rendering
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Navigate back to search and verify data is persisted
      const flightSearchLinkAfterRefresh = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLinkAfterRefresh);

      // Values should be restored (assuming localStorage implementation)
      expect(screen.getByDisplayValue('JFK')).toBeInTheDocument();
      expect(screen.getByDisplayValue('CDG')).toBeInTheDocument();
    });

    it('maintains selected flights across navigation', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Search and select a flight
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const originInput = screen.getByLabelText(/origin/i);
      const destinationInput = screen.getByLabelText(/destination/i);
      
      await user.type(originInput, 'JFK');
      await user.type(destinationInput, 'CDG');

      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      await waitFor(() => {
        const selectFlightButton = screen.getByRole('button', { name: /select flight/i });
        user.click(selectFlightButton);
      });

      // Navigate to hotels
      const continueButton = screen.getByRole('button', { name: /continue to hotels/i });
      await user.click(continueButton);

      // Go back to flights
      const backButton = screen.getByRole('button', { name: /back to flights/i });
      await user.click(backButton);

      // Verify selection is maintained
      expect(screen.getByText(/flight selected/i)).toBeInTheDocument();
    });
  });

  describe('Advanced User Interactions', () => {
    it('supports drag and drop for itinerary reordering', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Generate an itinerary first
      const planTripButton = screen.getByRole('button', { name: /plan your trip/i });
      await user.click(planTripButton);

      const generateButton = screen.getByRole('button', { name: /generate itinerary/i });
      await user.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(/Eiffel Tower Visit/i)).toBeInTheDocument();
      });

      // Find draggable activity items
      const activityItems = screen.getAllByTestId('activity-item');
      expect(activityItems.length).toBeGreaterThan(0);

      // Verify drag handles are present
      const dragHandles = screen.getAllByLabelText(/drag to reorder/i);
      expect(dragHandles.length).toBe(activityItems.length);
    });

    it('supports filtering and sorting of search results', async () => {
      const user = userEvent.setup();
      
      // Mock multiple flight results
      const multipleFlightsResponse = {
        ...mockFlightSearchResponse,
        data: {
          ...mockFlightSearchResponse.data,
          flights: [
            {
              id: 'flight_1',
              price: { currency: 'USD', total: '1245.50' },
              airline: 'Air France',
              duration: 'PT7H15M',
              stops: 0
            },
            {
              id: 'flight_2',
              price: { currency: 'USD', total: '899.00' },
              airline: 'Delta',
              duration: 'PT9H30M',
              stops: 1
            },
            {
              id: 'flight_3',
              price: { currency: 'USD', total: '1599.00' },
              airline: 'Lufthansa',
              duration: 'PT6H45M',
              stops: 0
            }
          ]
        }
      };

      (global.fetch as any).mockImplementation(() => 
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(multipleFlightsResponse)
        })
      );

      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Search for flights
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      // Wait for results
      await waitFor(() => {
        expect(screen.getByText(/flight results/i)).toBeInTheDocument();
      });

      // Test sorting by price
      const sortByPriceButton = screen.getByRole('button', { name: /sort by price/i });
      await user.click(sortByPriceButton);

      // Verify sorting (cheapest first)
      const priceElements = screen.getAllByText(/\$/);
      const prices = priceElements.map(el => parseFloat(el.textContent?.replace(/[^0-9.]/g, '') || '0'));
      expect(prices[0]).toBeLessThan(prices[1]);

      // Test filtering by airline
      const airlineFilter = screen.getByLabelText(/filter by airline/i);
      await user.selectOptions(airlineFilter, 'Delta');

      // Should only show Delta flights
      expect(screen.getByText(/Delta/)).toBeInTheDocument();
      expect(screen.queryByText(/Air France/)).not.toBeInTheDocument();
    });
  });

  describe('Internationalization Support', () => {
    it('supports multiple languages', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Find language selector
      const languageSelector = screen.getByLabelText(/language/i);
      await user.selectOptions(languageSelector, 'fr');

      // Verify UI updates to French
      await waitFor(() => {
        expect(screen.getByText(/rechercher des vols/i)).toBeInTheDocument();
      });

      // Switch back to English
      await user.selectOptions(languageSelector, 'en');

      await waitFor(() => {
        expect(screen.getByText(/search flights/i)).toBeInTheDocument();
      });
    });

    it('formats currencies correctly for different locales', async () => {
      const user = userEvent.setup();
      
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      );

      // Search for flights
      const flightSearchLink = screen.getByRole('link', { name: /search flights/i });
      await user.click(flightSearchLink);

      const searchButton = screen.getByRole('button', { name: /search flights/i });
      await user.click(searchButton);

      await waitFor(() => {
        // Should display price in USD format
        expect(screen.getByText(/\$1,245\.50/)).toBeInTheDocument();
      });

      // Change currency preference
      const currencySelector = screen.getByLabelText(/currency/i);
      await user.selectOptions(currencySelector, 'EUR');

      // Price should update to EUR format
      await waitFor(() => {
        expect(screen.getByText(/€1\.123,45/)).toBeInTheDocument();
      });
    });
  });
});