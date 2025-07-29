import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { theme } from '../../../utils/theme';
import SignupForm from '../../../components/auth/SignupForm';
import { authSlice } from '../../../store/slices/authSlice';

// Mock Firebase Auth
const mockCreateUserWithEmailAndPassword = vi.fn();
const mockUpdateProfile = vi.fn();
vi.mock('../../../services/auth/authService', () => ({
  authService: {
    createUserWithEmailAndPassword: mockCreateUserWithEmailAndPassword,
    updateProfile: mockUpdateProfile,
    signInWithGoogle: vi.fn()
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

describe('SignupForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders signup form elements correctly', () => {
    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up with google/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/i agree to the terms/i)).toBeInTheDocument();
    expect(screen.getByText(/already have an account/i)).toBeInTheDocument();
  });

  it('handles successful account creation', async () => {
    const user = userEvent.setup();
    const mockUser = {
      uid: 'user123',
      email: 'newuser@example.com',
      displayName: 'John Doe'
    };

    mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: mockUser });
    mockUpdateProfile.mockResolvedValue();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    // Fill in form fields
    await user.type(screen.getByLabelText(/first name/i), 'John');
    await user.type(screen.getByLabelText(/last name/i), 'Doe');
    await user.type(screen.getByLabelText(/email/i), 'newuser@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');
    await user.click(screen.getByLabelText(/i agree to the terms/i));

    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith(
        'newuser@example.com',
        'password123'
      );
    });

    await waitFor(() => {
      expect(mockUpdateProfile).toHaveBeenCalledWith(mockUser, {
        displayName: 'John Doe'
      });
    });

    // Should navigate to dashboard after successful signup
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('displays validation errors for empty required fields', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/last name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });

    expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('displays validation error for invalid email format', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    await user.type(screen.getByLabelText(/email/i), 'invalid-email');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/enter a valid email address/i)).toBeInTheDocument();
    });

    expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('displays validation error for short password', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password/i), '123');
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });

    expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('displays validation error for password mismatch', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    await user.type(screen.getByLabelText(/first name/i), 'John');
    await user.type(screen.getByLabelText(/last name/i), 'Doe');
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'differentpassword');
    
    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });

    expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('validates password strength requirements', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const passwordInput = screen.getByLabelText(/^password/i);
    
    // Test weak password
    await user.type(passwordInput, 'weak');
    
    await waitFor(() => {
      expect(screen.getByText(/password must contain at least/i)).toBeInTheDocument();
    });

    // Clear and test stronger password
    await user.clear(passwordInput);
    await user.type(passwordInput, 'StrongPass123!');
    
    await waitFor(() => {
      expect(screen.queryByText(/password must contain at least/i)).not.toBeInTheDocument();
    });
  });

  it('requires terms and conditions acceptance', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    // Fill all fields but don't accept terms
    await user.type(screen.getByLabelText(/first name/i), 'John');
    await user.type(screen.getByLabelText(/last name/i), 'Doe');
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'StrongPass123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'StrongPass123!');

    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/you must accept the terms and conditions/i)).toBeInTheDocument();
    });

    expect(mockCreateUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('handles signup failure with error message', async () => {
    const user = userEvent.setup();
    const errorMessage = 'Email already in use';

    mockCreateUserWithEmailAndPassword.mockRejectedValue(new Error(errorMessage));

    const store = createTestStore({ error: errorMessage });

    render(
      <TestWrapper store={store}>
        <SignupForm />
      </TestWrapper>
    );

    // Fill form with valid data
    await user.type(screen.getByLabelText(/first name/i), 'John');
    await user.type(screen.getByLabelText(/last name/i), 'Doe');
    await user.type(screen.getByLabelText(/email/i), 'existing@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');
    await user.click(screen.getByLabelText(/i agree to the terms/i));

    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows loading state during account creation', () => {
    const store = createTestStore({ loading: true });

    render(
      <TestWrapper store={store}>
        <SignupForm />
      </TestWrapper>
    );

    const submitButton = screen.getByRole('button', { name: /creating account/i });
    expect(submitButton).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('toggles password visibility for both password fields', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    const passwordToggle = screen.getByTestId('toggle-password-visibility');
    const confirmPasswordToggle = screen.getByTestId('toggle-confirm-password-visibility');

    // Initially passwords should be hidden
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(confirmPasswordInput).toHaveAttribute('type', 'password');

    // Click toggle to show password
    await user.click(passwordToggle);
    expect(passwordInput).toHaveAttribute('type', 'text');

    // Click toggle to show confirm password
    await user.click(confirmPasswordToggle);
    expect(confirmPasswordInput).toHaveAttribute('type', 'text');

    // Click toggles to hide passwords again
    await user.click(passwordToggle);
    await user.click(confirmPasswordToggle);
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(confirmPasswordInput).toHaveAttribute('type', 'password');
  });

  it('shows password strength indicator', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const passwordInput = screen.getByLabelText(/^password/i);

    // Test weak password
    await user.type(passwordInput, 'weak');
    expect(screen.getByText(/weak/i)).toBeInTheDocument();
    expect(screen.getByTestId('password-strength-weak')).toBeInTheDocument();

    // Test medium password
    await user.clear(passwordInput);
    await user.type(passwordInput, 'Medium123');
    expect(screen.getByText(/medium/i)).toBeInTheDocument();
    expect(screen.getByTestId('password-strength-medium')).toBeInTheDocument();

    // Test strong password
    await user.clear(passwordInput);
    await user.type(passwordInput, 'VeryStrong123!');
    expect(screen.getByText(/strong/i)).toBeInTheDocument();
    expect(screen.getByTestId('password-strength-strong')).toBeInTheDocument();
  });

  it('handles Google signup button click', async () => {
    const user = userEvent.setup();
    const mockSignInWithGoogle = vi.fn();

    vi.mocked(require('../../../services/auth/authService').authService.signInWithGoogle)
      .mockImplementation(mockSignInWithGoogle);

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const googleButton = screen.getByRole('button', { name: /sign up with google/i });
    await user.click(googleButton);

    expect(mockSignInWithGoogle).toHaveBeenCalled();
  });

  it('displays terms and conditions modal when link is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const termsLink = screen.getByText(/terms and conditions/i);
    await user.click(termsLink);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/terms of service/i)).toBeInTheDocument();
  });

  it('validates name fields for proper format', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    // Test names with numbers (should be invalid)
    await user.type(screen.getByLabelText(/first name/i), 'John123');
    await user.type(screen.getByLabelText(/last name/i), 'Doe456');

    const submitButton = screen.getByRole('button', { name: /create account/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/name should only contain letters/i)).toBeInTheDocument();
    });
  });

  it('has proper accessibility attributes', () => {
    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const form = screen.getByRole('form');
    expect(form).toHaveAttribute('aria-label', 'Create a new account');

    // Check required fields have aria-required
    const requiredFields = [
      screen.getByLabelText(/first name/i),
      screen.getByLabelText(/last name/i),
      screen.getByLabelText(/email/i),
      screen.getByLabelText(/^password/i),
      screen.getByLabelText(/confirm password/i)
    ];

    requiredFields.forEach(field => {
      expect(field).toHaveAttribute('aria-required', 'true');
      expect(field).toHaveAttribute('aria-describedby');
    });

    const submitButton = screen.getByRole('button', { name: /create account/i });
    expect(submitButton).toHaveAttribute('type', 'submit');
  });

  it('clears error message when user starts typing', async () => {
    const user = userEvent.setup();
    const store = createTestStore({ error: 'Previous error message' });

    render(
      <TestWrapper store={store}>
        <SignupForm />
      </TestWrapper>
    );

    // Error should be visible initially
    expect(screen.getByText('Previous error message')).toBeInTheDocument();

    // Start typing in first name field
    const firstNameInput = screen.getByLabelText(/first name/i);
    await user.type(firstNameInput, 'J');

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
        <SignupForm />
      </TestWrapper>
    );

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('validates email uniqueness on blur', async () => {
    const user = userEvent.setup();
    const mockCheckEmailExists = vi.fn().mockResolvedValue(true);

    vi.doMock('../../../services/auth/authService', () => ({
      authService: {
        checkEmailExists: mockCheckEmailExists
      }
    }));

    render(
      <TestWrapper>
        <SignupForm />
      </TestWrapper>
    );

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'existing@example.com');
    await user.tab(); // Trigger blur event

    await waitFor(() => {
      expect(mockCheckEmailExists).toHaveBeenCalledWith('existing@example.com');
      expect(screen.getByText(/email is already registered/i)).toBeInTheDocument();
    });
  });
});