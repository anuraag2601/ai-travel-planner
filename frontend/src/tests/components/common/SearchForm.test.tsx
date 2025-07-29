import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '../../../utils/theme';
import SearchForm from '../../../components/common/SearchForm';

// Mock date picker
vi.mock('@mui/x-date-pickers', () => ({
  DatePicker: ({ label, value, onChange, ...props }: any) => (
    <input
      data-testid={`date-picker-${label.toLowerCase().replace(' ', '-')}`}
      type="date"
      value={value ? value.toISOString().split('T')[0] : ''}
      onChange={(e) => onChange && onChange(new Date(e.target.value))}
      {...props}
    />
  ),
  LocalizationProvider: ({ children }: any) => children,
  AdapterDateFns: vi.fn()
}));

// Mock autocomplete
vi.mock('@mui/material/Autocomplete', () => ({
  default: ({ options, renderInput, onChange, ...props }: any) => {
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedOption = options.find((opt: any) => opt.iataCode === e.target.value);
      onChange && onChange(e, selectedOption);
    };

    return (
      <select
        data-testid={props['data-testid'] || 'autocomplete'}
        onChange={handleChange}
        {...props}
      >
        <option value="">Select option</option>
        {options.map((option: any) => (
          <option key={option.iataCode} value={option.iataCode}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }
}));

// Test wrapper
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    {children}
  </ThemeProvider>
);

// Mock props
const mockProps = {
  onSearch: vi.fn(),
  loading: false,
  error: null,
  type: 'flight' as const
};

const mockLocations = [
  {
    iataCode: 'JFK',
    name: 'John F Kennedy International Airport',
    city: 'New York',
    country: 'United States'
  },
  {
    iataCode: 'CDG',
    name: 'Charles de Gaulle Airport',
    city: 'Paris',
    country: 'France'
  }
];

describe('SearchForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders flight search form correctly', () => {
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    expect(screen.getByTestId('origin-input')).toBeInTheDocument();
    expect(screen.getByTestId('destination-input')).toBeInTheDocument();
    expect(screen.getByTestId('date-picker-departure-date')).toBeInTheDocument();
    expect(screen.getByTestId('date-picker-return-date')).toBeInTheDocument();
    expect(screen.getByLabelText(/adults/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search flights/i })).toBeInTheDocument();
  });

  it('renders hotel search form correctly', () => {
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="hotel" />
      </TestWrapper>
    );

    expect(screen.getByTestId('destination-input')).toBeInTheDocument();
    expect(screen.getByTestId('date-picker-check-in-date')).toBeInTheDocument();
    expect(screen.getByTestId('date-picker-check-out-date')).toBeInTheDocument();
    expect(screen.getByLabelText(/rooms/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/guests/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search hotels/i })).toBeInTheDocument();
  });

  it('handles form submission with valid flight data', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    // Fill in form fields
    const originSelect = screen.getByTestId('origin-input');
    const destinationSelect = screen.getByTestId('destination-input');
    const departureDate = screen.getByTestId('date-picker-departure-date');
    const returnDate = screen.getByTestId('date-picker-return-date');
    const adultsInput = screen.getByLabelText(/adults/i);

    await user.selectOptions(originSelect, 'JFK');
    await user.selectOptions(destinationSelect, 'CDG');
    await user.type(departureDate, '2024-03-15');
    await user.type(returnDate, '2024-03-22');
    await user.clear(adultsInput);
    await user.type(adultsInput, '2');

    // Submit form
    const submitButton = screen.getByRole('button', { name: /search flights/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockProps.onSearch).toHaveBeenCalledWith({
        originLocationCode: 'JFK',
        destinationLocationCode: 'CDG',
        departureDate: '2024-03-15',
        returnDate: '2024-03-22',
        adults: 2,
        children: 0,
        infants: 0
      });
    });
  });

  it('handles form submission with valid hotel data', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="hotel" />
      </TestWrapper>
    );

    // Fill in form fields
    const destinationSelect = screen.getByTestId('destination-input');
    const checkInDate = screen.getByTestId('date-picker-check-in-date');
    const checkOutDate = screen.getByTestId('date-picker-check-out-date');
    const roomsInput = screen.getByLabelText(/rooms/i);
    const guestsInput = screen.getByLabelText(/guests/i);

    await user.selectOptions(destinationSelect, 'CDG');
    await user.type(checkInDate, '2024-03-15');
    await user.type(checkOutDate, '2024-03-22');
    await user.clear(roomsInput);
    await user.type(roomsInput, '1');
    await user.clear(guestsInput);
    await user.type(guestsInput, '2');

    // Submit form
    const submitButton = screen.getByRole('button', { name: /search hotels/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockProps.onSearch).toHaveBeenCalledWith({
        cityCode: 'CDG',
        checkInDate: '2024-03-15',
        checkOutDate: '2024-03-22',
        roomQuantity: 1,
        adults: 2
      });
    });
  });

  it('displays validation errors for invalid input', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    // Try to submit form without required fields
    const submitButton = screen.getByRole('button', { name: /search flights/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/origin is required/i)).toBeInTheDocument();
      expect(screen.getByText(/destination is required/i)).toBeInTheDocument();
    });

    // onSearch should not be called with invalid data
    expect(mockProps.onSearch).not.toHaveBeenCalled();
  });

  it('shows loading state when searching', () => {
    render(
      <TestWrapper>
        <SearchForm {...mockProps} loading={true} />
      </TestWrapper>
    );

    const submitButton = screen.getByRole('button', { name: /searching/i });
    expect(submitButton).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('displays error message when search fails', () => {
    const errorMessage = 'Search failed. Please try again.';
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} error={errorMessage} />
      </TestWrapper>
    );

    expect(screen.getByText(errorMessage)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('handles passenger count changes correctly', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    const adultsInput = screen.getByLabelText(/adults/i);
    const childrenInput = screen.getByLabelText(/children/i);
    const infantsInput = screen.getByLabelText(/infants/i);

    // Test increment/decrement buttons
    const incrementAdults = screen.getByTestId('increment-adults');
    const decrementAdults = screen.getByTestId('decrement-adults');

    await user.click(incrementAdults);
    expect(adultsInput).toHaveValue(2);

    await user.click(decrementAdults);
    expect(adultsInput).toHaveValue(1);

    // Test minimum value constraint
    await user.click(decrementAdults);
    expect(adultsInput).toHaveValue(1); // Should not go below 1

    // Test children input
    await user.clear(childrenInput);
    await user.type(childrenInput, '2');
    expect(childrenInput).toHaveValue(2);

    // Test infants input
    await user.clear(infantsInput);
    await user.type(infantsInput, '1');
    expect(infantsInput).toHaveValue(1);
  });

  it('handles date validation correctly', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    const departureDate = screen.getByTestId('date-picker-departure-date');
    const returnDate = screen.getByTestId('date-picker-return-date');

    // Set return date before departure date
    await user.type(departureDate, '2024-03-22');
    await user.type(returnDate, '2024-03-15');

    const submitButton = screen.getByRole('button', { name: /search flights/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/return date must be after departure date/i)).toBeInTheDocument();
    });

    expect(mockProps.onSearch).not.toHaveBeenCalled();
  });

  it('clears form when reset button is clicked', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    // Fill in some form fields
    const originSelect = screen.getByTestId('origin-input');
    const adultsInput = screen.getByLabelText(/adults/i);

    await user.selectOptions(originSelect, 'JFK');
    await user.clear(adultsInput);
    await user.type(adultsInput, '3');

    // Click reset button
    const resetButton = screen.getByRole('button', { name: /reset/i });
    await user.click(resetButton);

    // Form should be cleared
    expect(originSelect).toHaveValue('');
    expect(adultsInput).toHaveValue(1);
  });

  it('handles location autocomplete correctly', async () => {
    const user = userEvent.setup();
    
    // Mock the location search API
    const mockLocationSearch = vi.fn().mockResolvedValue(mockLocations);
    
    render(
      <TestWrapper>
        <SearchForm 
          {...mockProps} 
          type="flight" 
          onLocationSearch={mockLocationSearch}
        />
      </TestWrapper>
    );

    const originInput = screen.getByTestId('origin-input');
    
    // Type in origin input to trigger search
    await user.type(originInput, 'JFK');

    await waitFor(() => {
      expect(mockLocationSearch).toHaveBeenCalledWith('JFK');
    });
  });

  it('toggles trip type between one-way and round-trip', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <SearchForm {...mockProps} type="flight" />
      </TestWrapper>
    );

    const tripTypeToggle = screen.getByLabelText(/trip type/i);
    const returnDatePicker = screen.getByTestId('date-picker-return-date');

    // Initially should be round-trip
    expect(returnDatePicker).toBeVisible();

    // Switch to one-way
    await user.click(tripTypeToggle);
    expect(returnDatePicker).not.toBeVisible();

    // Switch back to round-trip
    await user.click(tripTypeToggle);
    expect(returnDatePicker).toBeVisible();
  });
});