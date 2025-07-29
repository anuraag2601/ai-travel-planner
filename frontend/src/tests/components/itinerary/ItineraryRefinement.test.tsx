import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { theme } from '../../../utils/theme';
import ItineraryRefinement from '../../../components/itinerary/ItineraryRefinement';
import { searchSlice } from '../../../store/slices/searchSlice';

// Mock services
const mockRefineItinerary = vi.fn();
vi.mock('../../../services/api/itineraryService', () => ({
  itineraryService: {
    refineItinerary: mockRefineItinerary
  }
}));

// Test store setup
const createTestStore = (initialState = {}) => {
  return configureStore({
    reducer: {
      search: searchSlice.reducer
    },
    preloadedState: {
      search: {
        currentItinerary: null,
        refinementLoading: false,
        refinementError: null,
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

// Mock itinerary data
const mockItinerary = {
  id: 'itinerary-123',
  overview: {
    title: '5-Day Paris Adventure',
    description: 'A perfect blend of culture, cuisine, and iconic sights',
    highlights: ['Eiffel Tower', 'Louvre Museum'],
    themes: ['Culture', 'History']
  },
  totalBudget: {
    estimated: 2500,
    currency: 'USD',
    breakdown: {
      accommodation: 1000,
      activities: 600,
      food: 500,
      transportation: 400
    },
    confidence: 0.85
  },
  dailyItinerary: [
    {
      day: 1,
      date: '2024-06-15',
      theme: 'Arrival & Iconic Paris',
      activities: [
        {
          time: '10:00',
          title: 'Eiffel Tower Visit',
          type: 'sightseeing',
          cost: { amount: 29, currency: 'USD' }
        }
      ],
      meals: [
        {
          time: '13:00',
          type: 'lunch',
          restaurant: { name: 'Café de Flore', cuisine: 'French' }
        }
      ]
    }
  ]
};

describe('ItineraryRefinement Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders refinement options correctly', () => {
    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    expect(screen.getByText('Refine Your Itinerary')).toBeInTheDocument();
    expect(screen.getByText('Budget Adjustment')).toBeInTheDocument();
    expect(screen.getByText('Activity Preferences')).toBeInTheDocument();
    expect(screen.getByText('Pace Adjustment')).toBeInTheDocument();
    expect(screen.getByText('Custom Modifications')).toBeInTheDocument();
  });

  it('handles budget refinement', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary, totalBudget: { ...mockItinerary.totalBudget, estimated: 3000 } };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click budget adjustment tab
    const budgetTab = screen.getByText('Budget Adjustment');
    await user.click(budgetTab);

    // Adjust budget slider
    const budgetSlider = screen.getByRole('slider', { name: /total budget/i });
    fireEvent.change(budgetSlider, { target: { value: '3000' } });

    // Submit refinement
    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'change_budget',
        details: {
          newBudget: 3000,
          currency: 'USD',
          adjustCategories: true
        }
      });
    });
  });

  it('handles activity preference refinement', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click activity preferences tab
    const activityTab = screen.getByText('Activity Preferences');
    await user.click(activityTab);

    // Select new interests
    const interestChips = screen.getAllByRole('button', { name: /interest/i });
    await user.click(interestChips[0]); // Museums
    await user.click(interestChips[1]); // Food tours

    // Submit refinement
    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'add_preferences',
        details: {
          interests: expect.arrayContaining(['museums', 'food-tours'])
        }
      });
    });
  });

  it('handles pace adjustment', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click pace adjustment tab
    const paceTab = screen.getByText('Pace Adjustment');
    await user.click(paceTab);

    // Select relaxed pace
    const relaxedOption = screen.getByLabelText(/relaxed/i);
    await user.click(relaxedOption);

    // Submit refinement
    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'adjust_pace',
        details: {
          pace: 'relaxed'
        }
      });
    });
  });

  it('handles custom text modifications', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click custom modifications tab
    const customTab = screen.getByText('Custom Modifications');
    await user.click(customTab);

    // Enter custom feedback
    const feedbackInput = screen.getByLabelText(/describe your changes/i);
    await user.type(feedbackInput, 'Please add more food experiences and reduce museum visits');

    // Submit refinement
    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'custom_modification',
        details: {
          userFeedback: 'Please add more food experiences and reduce museum visits'
        }
      });
    });
  });

  it('shows activity-specific refinement options', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click on a specific activity to refine
    const activityItem = screen.getByText('Eiffel Tower Visit');
    await user.click(activityItem);

    // Should show activity-specific options
    expect(screen.getByText('Replace Activity')).toBeInTheDocument();
    expect(screen.getByText('Modify Time')).toBeInTheDocument();
    expect(screen.getByText('Remove Activity')).toBeInTheDocument();
  });

  it('handles activity replacement', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click on activity
    const activityItem = screen.getByText('Eiffel Tower Visit');
    await user.click(activityItem);

    // Click replace activity
    const replaceButton = screen.getByText('Replace Activity');
    await user.click(replaceButton);

    // Select new activity from suggestions
    const newActivity = screen.getByText('Louvre Museum Tour');
    await user.click(newActivity);

    // Apply changes
    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'modify_activity',
        details: {
          day: 1,
          removeActivity: 'Eiffel Tower Visit',
          addActivity: 'Louvre Museum Tour'
        }
      });
    });
  });

  it('handles activity time modification', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click on activity
    const activityItem = screen.getByText('Eiffel Tower Visit');
    await user.click(activityItem);

    // Click modify time
    const modifyTimeButton = screen.getByText('Modify Time');
    await user.click(modifyTimeButton);

    // Change time
    const timeInput = screen.getByLabelText(/activity time/i);
    await user.clear(timeInput);
    await user.type(timeInput, '14:00');

    // Apply changes
    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'modify_activity',
        details: {
          day: 1,
          activityId: 'Eiffel Tower Visit',
          newTime: '14:00'
        }
      });
    });
  });

  it('handles activity removal', async () => {
    const user = userEvent.setup();
    const refinedItinerary = { ...mockItinerary };
    mockRefineItinerary.mockResolvedValue(refinedItinerary);

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click on activity
    const activityItem = screen.getByText('Eiffel Tower Visit');
    await user.click(activityItem);

    // Click remove activity
    const removeButton = screen.getByText('Remove Activity');
    await user.click(removeButton);

    // Confirm removal
    const confirmButton = screen.getByRole('button', { name: /confirm/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockRefineItinerary).toHaveBeenCalledWith(mockItinerary.id, {
        type: 'modify_activity',
        details: {
          day: 1,
          removeActivity: 'Eiffel Tower Visit'
        }
      });
    });
  });

  it('shows loading state during refinement', async () => {
    const user = userEvent.setup();
    const store = createTestStore({ refinementLoading: true });

    render(
      <TestWrapper store={store}>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    expect(screen.getByText('Refining itinerary...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    
    // Apply button should be disabled
    const applyButton = screen.getByRole('button', { name: /refining/i });
    expect(applyButton).toBeDisabled();
  });

  it('displays refinement error', () => {
    const store = createTestStore({ 
      refinementError: 'Failed to refine itinerary. Please try again.' 
    });

    render(
      <TestWrapper store={store}>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    expect(screen.getByText('Failed to refine itinerary. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('handles budget category adjustments', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click budget adjustment tab
    const budgetTab = screen.getByText('Budget Adjustment');
    await user.click(budgetTab);

    // Enable individual category adjustment
    const categoryToggle = screen.getByLabelText(/adjust categories individually/i);
    await user.click(categoryToggle);

    // Adjust accommodation budget
    const accommodationSlider = screen.getByRole('slider', { name: /accommodation/i });
    fireEvent.change(accommodationSlider, { target: { value: '1200' } });

    // Adjust activities budget
    const activitiesSlider = screen.getByRole('slider', { name: /activities/i });
    fireEvent.change(activitiesSlider, { target: { value: '800' } });

    expect(screen.getByDisplayValue('1200')).toBeInTheDocument();
    expect(screen.getByDisplayValue('800')).toBeInTheDocument();
  });

  it('validates budget constraints', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Click budget adjustment tab
    const budgetTab = screen.getByText('Budget Adjustment');
    await user.click(budgetTab);

    // Try to set unrealistically low budget
    const budgetSlider = screen.getByRole('slider', { name: /total budget/i });
    fireEvent.change(budgetSlider, { target: { value: '100' } });

    const applyButton = screen.getByRole('button', { name: /apply changes/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(screen.getByText(/budget too low for destination/i)).toBeInTheDocument();
    });

    expect(mockRefineItinerary).not.toHaveBeenCalled();
  });

  it('shows refinement preview before applying', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Make a change
    const budgetTab = screen.getByText('Budget Adjustment');
    await user.click(budgetTab);

    const budgetSlider = screen.getByRole('slider', { name: /total budget/i });
    fireEvent.change(budgetSlider, { target: { value: '3000' } });

    // Click preview button
    const previewButton = screen.getByRole('button', { name: /preview changes/i });
    await user.click(previewButton);

    // Should show preview dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Preview Changes')).toBeInTheDocument();
    expect(screen.getByText('Budget: $2,500 → $3,000')).toBeInTheDocument();
  });

  it('resets changes when cancel is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Make changes
    const budgetTab = screen.getByText('Budget Adjustment');
    await user.click(budgetTab);

    const budgetSlider = screen.getByRole('slider', { name: /total budget/i });
    fireEvent.change(budgetSlider, { target: { value: '3000' } });

    // Cancel changes
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    // Should reset to original values
    expect(budgetSlider).toHaveValue('2500');
  });

  it('has proper accessibility attributes', () => {
    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-label', 'Refinement options');

    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab, index) => {
      expect(tab).toHaveAttribute('aria-controls');
      expect(tab).toHaveAttribute('id');
    });

    const sliders = screen.getAllByRole('slider');
    sliders.forEach(slider => {
      expect(slider).toHaveAttribute('aria-valuemin');
      expect(slider).toHaveAttribute('aria-valuemax');
      expect(slider).toHaveAttribute('aria-valuenow');
    });
  });

  it('handles keyboard navigation in refinement tabs', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryRefinement itinerary={mockItinerary} />
      </TestWrapper>
    );

    const firstTab = screen.getAllByRole('tab')[0];
    firstTab.focus();

    // Arrow keys should navigate between tabs
    await user.keyboard('{ArrowRight}');
    expect(screen.getAllByRole('tab')[1]).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(firstTab).toHaveFocus();

    // Enter should activate tab
    await user.keyboard('{Enter}');
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
  });
});