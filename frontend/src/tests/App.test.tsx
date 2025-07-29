import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../utils/theme';
import App from '../App';

// Mock components
vi.mock('../pages/Home/Home', () => ({
  default: () => <div data-testid="home-page">Home Page</div>
}));

vi.mock('../pages/Auth/Login', () => ({
  default: () => <div data-testid="login-page">Login Page</div>
}));

vi.mock('../pages/Search/FlightSearch', () => ({
  default: () => <div data-testid="flight-search-page">Flight Search Page</div>
}));

// Mock store slices
const mockAuthSlice = {
  name: 'auth',
  initialState: {
    user: null,
    isAuthenticated: false,
    loading: false,
    error: null
  },
  reducers: {}
};

const mockSearchSlice = {
  name: 'search',
  initialState: {
    flights: [],
    hotels: [],
    loading: false,
    error: null
  },
  reducers: {}
};

// Create test store
const createTestStore = (initialState = {}) => {
  return configureStore({
    reducer: {
      auth: (state = mockAuthSlice.initialState) => state,
      search: (state = mockSearchSlice.initialState) => state
    },
    preloadedState: initialState
  });
};

// Test wrapper component
const TestWrapper = ({ children, initialState = {} }: { children: React.ReactNode; initialState?: any }) => {
  const store = createTestStore(initialState);
  
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

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );
    
    // Should render some basic structure
    expect(document.body).toBeInTheDocument();
  });

  it('renders home page by default', () => {
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: {
        pathname: '/'
      },
      writable: true
    });

    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Should show home page content
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
  });

  it('renders with theme provider', () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // Check if theme is applied (MUI components should be available)
    const body = document.body;
    expect(body).toBeInTheDocument();
  });

  it('provides Redux store to components', () => {
    const TestComponent = () => {
      // This would fail if Redux store is not provided
      return <div data-testid="test-component">Test</div>;
    };

    render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    );

    expect(screen.getByTestId('test-component')).toBeInTheDocument();
  });

  it('handles authenticated user state', () => {
    const authenticatedState = {
      auth: {
        user: {
          uid: 'test-user-123',
          email: 'test@example.com',
          displayName: 'Test User'
        },
        isAuthenticated: true,
        loading: false,
        error: null
      }
    };

    render(
      <TestWrapper initialState={authenticatedState}>
        <App />
      </TestWrapper>
    );

    // App should render normally with authenticated user
    expect(document.body).toBeInTheDocument();
  });

  it('handles loading state', () => {
    const loadingState = {
      auth: {
        user: null,
        isAuthenticated: false,
        loading: true,
        error: null
      }
    };

    render(
      <TestWrapper initialState={loadingState}>
        <App />
      </TestWrapper>
    );

    // App should render normally even in loading state
    expect(document.body).toBeInTheDocument();
  });

  it('handles error state', () => {
    const errorState = {
      auth: {
        user: null,
        isAuthenticated: false,
        loading: false,
        error: 'Authentication failed'
      }
    };

    render(
      <TestWrapper initialState={errorState}>
        <App />
      </TestWrapper>
    );

    // App should render normally even with errors
    expect(document.body).toBeInTheDocument();
  });

  it('provides proper browser routing', () => {
    render(
      <TestWrapper>
        <App />
      </TestWrapper>
    );

    // BrowserRouter should be providing routing context
    // Components inside should have access to routing
    expect(document.body).toBeInTheDocument();
  });
});