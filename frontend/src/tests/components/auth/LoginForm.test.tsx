import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { theme } from '../../../utils/theme';
import LoginForm from '../../../components/auth/LoginForm';
import { authSlice } from '../../../store/slices/authSlice';

// Mock Firebase Auth
const mockSignInWithEmailAndPassword = vi.fn();
vi.mock('../../../services/auth/authService', () => ({
  authService: {
    signInWithEmailAndPassword: mockSignInWithEmailAndPassword,
    signInWithGoogle: vi.fn(),
    resetPassword: vi.fn()
  }
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: any) => <a href={to}>{children}</a>
}));

// Test store setup
const createTestStore = (initialState = {}) => {
  return configureStore({
    reducer: {
      auth: authSlice.reducer
    },
    preloadedState: {
      auth: {
        user: null,
        loading: false,
        error: null,
        isAuthenticated: false,
        ...initialState
      }
    }
  });
};

// Test wrapper
const TestWrapper = ({ 
  children, 
  store = createTestStore() 
}: { 
  children: React.ReactNode;
  store?: any;
}) => (
  <Provider store={store}>
    <ThemeProvider theme={theme}>
      {children}
    </ThemeProvider>
  </Provider>
);

describe('LoginForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form elements correctly', () => {
    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.getByText(/forgot password/i)).toBeInTheDocument();
    expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
  });

  it('handles successful login with email and password', async () => {
    const user = userEvent.setup();
    const mockUser = {
      uid: 'user123',
      email: 'test@example.com',
      displayName: 'Test User'
    };

    mockSignInWithEmailAndPassword.mockResolvedValue({ user: mockUser });

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    // Fill in form fields
    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        'test@example.com',
        'password123'
      );
    });

    // Should navigate to dashboard after successful login
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays validation errors for empty fields', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });

    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('displays validation error for invalid email format', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'invalid-email');
    await user.type(passwordInput, 'password123');
    
    const submitButton = screen.getByRole('button', { name: /sign in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    });

    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('displays validation error for short password', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, '123');
    
    const submitButton = screen.getByRole('button', { name: /sign in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
    });

    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('handles login failure with error message', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Invalid email or password';

    mockSignInWithEmailAndPassword.mockRejectedValue(new Error(errorMessage));

    const store = createTestStore({ error: errorMessage });

    render(
      <TestWrapper store={store}>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'wrongpassword');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows loading state during authentication', () => {
    const store = createTestStore({ loading: true });

    render(
      <TestWrapper store={store}>
        <LoginForm />
      </TestWrapper>
    );

    const submitButton = screen.getByRole('button', { name: /signing in/i });
    expect(submitButton).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const passwordInput = screen.getByLabelText(/password/i);
    const toggleButton = screen.getByRole('button', { name: /toggle password visibility/i });

    // Initially password should be hidden
    expect(passwordInput).toHaveAttribute('type', 'password');

    // Click toggle to show password
    await user.click(toggleButton);
    expect(passwordInput).toHaveAttribute('type', 'text');

    // Click toggle to hide password again
    await user.click(toggleButton);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('handles Remember Me checkbox', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const rememberMeCheckbox = screen.getByLabelText(/remember me/i);

    // Initially unchecked
    expect(rememberMeCheckbox).not.toBeChecked();

    // Click to check
    await user.click(rememberMeCheckbox);
    expect(rememberMeCheckbox).toBeChecked();

    // Click to uncheck
    await user.click(rememberMeCheckbox);
    expect(rememberMeCheckbox).not.toBeChecked();
  });

  it('handles Google sign-in button click', async () => {
    const user = userEvent.setup();
    const mockSignInWithGoogle = vi.fn();

    vi.mocked(require('../../../services/auth/authService').authService.signInWithGoogle)
      .mockImplementation(mockSignInWithGoogle);

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const googleButton = screen.getByRole('button', { name: /sign in with google/i });
    await user.click(googleButton);

    expect(mockSignInWithGoogle).toHaveBeenCalled();
  });

  it('handles forgot password link click', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const forgotPasswordLink = screen.getByText(/forgot password/i);
    await user.click(forgotPasswordLink);

    // Should show forgot password dialog or navigate
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/reset password/i)).toBeInTheDocument();
  });

  it('handles keyboard navigation correctly', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    // Tab through form elements
    await user.tab();
    expect(emailInput).toHaveFocus();

    await user.tab();
    expect(passwordInput).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText(/remember me/i)).toHaveFocus();

    await user.tab();
    expect(submitButton).toHaveFocus();

    // Enter key should submit form when on submit button
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    submitButton.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalled();
    });
  });

  it('clears error message when user starts typing', async () => {
    const user = userEvent.setup();
    const store = createTestStore({ error: 'Previous error message' });

    render(
      <TestWrapper store={store}>
        <LoginForm />
      </TestWrapper>
    );

    // Error should be visible initially
    expect(screen.getByText('Previous error message')).toBeInTheDocument();

    // Start typing in email field
    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 't');

    // Error should be cleared
    await waitFor(() => {
      expect(screen.queryByText('Previous error message')).not.toBeInTheDocument();
    });
  });

  it('redirects to dashboard if user is already authenticated', () => {
    const store = createTestStore({ 
      isAuthenticated: true,
      user: { uid: 'user123', email: 'test@example.com' }
    });

    render(
      <TestWrapper store={store}>
        <LoginForm />
      </TestWrapper>
    );

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('handles form submission with Enter key in password field', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'password123');
    
    // Press Enter in password field
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        'test@example.com',
        'password123'
      );
    });
  });

  it('has proper accessibility attributes', () => {
    render(
      <TestWrapper>
        <LoginForm />
      </TestWrapper>
    );

    const form = screen.getByRole('form');
    expect(form).toHaveAttribute('aria-label', 'Sign in to your account');

    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('aria-required', 'true');
    expect(emailInput).toHaveAttribute('aria-describedby');

    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute('aria-required', 'true');
    expect(passwordInput).toHaveAttribute('aria-describedby');

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    expect(submitButton).toHaveAttribute('type', 'submit');
  });
});