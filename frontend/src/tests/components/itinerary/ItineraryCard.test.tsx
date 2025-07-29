import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { theme } from '../../../utils/theme';
import ItineraryCard from '../../../components/itinerary/ItineraryCard';
import { searchSlice } from '../../../store/slices/searchSlice';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ children, to }: any) => <a href={to}>{children}</a>
}));

// Mock services
const mockSaveItinerary = vi.fn();
const mockDeleteItinerary = vi.fn();
const mockShareItinerary = vi.fn();
vi.mock('../../../services/api/itineraryService', () => ({
  itineraryService: {
    saveItinerary: mockSaveItinerary,
    deleteItinerary: mockDeleteItinerary,
    shareItinerary: mockShareItinerary
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
        savedItineraries: [],
        loading: false,
        error: null,
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
    highlights: ['Eiffel Tower', 'Louvre Museum', 'Notre-Dame Cathedral'],
    themes: ['Culture', 'History', 'Cuisine']
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
      location: 'Central Paris',
      activities: [
        {
          time: '10:00',
          duration: 180,
          type: 'sightseeing',
          title: 'Eiffel Tower Visit',
          description: 'Visit the iconic Eiffel Tower and enjoy panoramic views',
          location: {
            name: 'Eiffel Tower',
            address: 'Champ de Mars, 75007 Paris'
          },
          cost: {
            amount: 29,
            currency: 'USD',
            priceType: 'fixed'
          },
          bookingInfo: {
            required: true,
            website: 'https://www.toureiffel.paris'
          },
          accessibility: {
            wheelchairAccessible: true,
            mobilityFriendly: true
          },
          tips: ['Book in advance', 'Visit early morning'],
          alternatives: ['Trocadéro viewpoint']
        }
      ],
      meals: [
        {
          time: '13:00',
          type: 'lunch',
          restaurant: {
            name: 'Café de Flore',
            cuisine: 'French',
            location: 'Saint-Germain',
            priceRange: '$$$',
            atmosphere: 'Historic literary café'
          },
          estimatedCost: {
            amount: 45,
            currency: 'USD'
          },
          reservationInfo: {
            required: false
          },
          highlights: ['Famous literary history', 'Classic French dishes'],
          dietaryOptions: ['Vegetarian options available']
        }
      ],
      transportation: [
        {
          from: 'Hotel',
          to: 'Eiffel Tower',
          method: 'metro',
          duration: 25,
          cost: {
            amount: 2,
            currency: 'USD'
          },
          instructions: 'Take Line 6 to Bir-Hakeim',
          alternatives: ['Bus', 'Taxi']
        }
      ],
      dailyBudget: {
        estimated: 500,
        breakdown: {
          activities: 200,
          food: 150,
          transportation: 100,
          miscellaneous: 50
        }
      },
      tips: ['Start early', 'Wear comfortable shoes'],
      alternatives: []
    }
  ],
  travelTips: {
    general: ['Learn basic French phrases', 'Validate metro tickets'],
    cultural: ['Greet shopkeepers', 'Dining etiquette'],
    practical: ['Carry water bottle', 'Check museum hours'],
    safety: ['Watch for pickpockets', 'Emergency contacts']
  },
  generationMetadata: {
    model: 'claude-3-haiku-20240307',
    confidence: 0.85,
    tokensUsed: 3500,
    generatedAt: '2024-01-15T10:30:00Z',
    version: '1.0'
  },
  createdAt: '2024-01-15T10:30:00Z',
  updatedAt: '2024-01-15T10:30:00Z',
  isSaved: false
};

describe('ItineraryCard Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders itinerary card with basic information', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    expect(screen.getByText('5-Day Paris Adventure')).toBeInTheDocument();
    expect(screen.getByText('A perfect blend of culture, cuisine, and iconic sights')).toBeInTheDocument();
    expect(screen.getByText('$2,500')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
    expect(screen.getByText('85% confidence')).toBeInTheDocument();
  });

  it('displays highlights correctly', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    mockItinerary.overview.highlights.forEach(highlight => {
      expect(screen.getByText(highlight)).toBeInTheDocument();
    });
  });

  it('displays themes with proper styling', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    mockItinerary.overview.themes.forEach(theme => {
      const themeElement = screen.getByText(theme);
      expect(themeElement).toBeInTheDocument();
      expect(themeElement.closest('.theme-chip')).toBeInTheDocument();
    });
  });

  it('shows budget breakdown on hover/click', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const budgetSection = screen.getByTestId('budget-section');
    await user.hover(budgetSection);

    await waitFor(() => {
      expect(screen.getByText('Accommodation: $1,000')).toBeInTheDocument();
      expect(screen.getByText('Activities: $600')).toBeInTheDocument();
      expect(screen.getByText('Food: $500')).toBeInTheDocument();
      expect(screen.getByText('Transportation: $400')).toBeInTheDocument();
    });
  });

  it('handles save itinerary action', async () => {
    const user = userEvent.setup();
    mockSaveItinerary.mockResolvedValue({ success: true });

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const saveButton = screen.getByRole('button', { name: /save itinerary/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockSaveItinerary).toHaveBeenCalledWith(mockItinerary);
    });

    // Button should show saved state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument();
    });
  });

  it('handles unsave itinerary action for saved itinerary', async () => {
    const user = userEvent.setup();
    const savedItinerary = { ...mockItinerary, isSaved: true };
    mockDeleteItinerary.mockResolvedValue({ success: true });

    render(
      <TestWrapper>
        <ItineraryCard itinerary={savedItinerary} />
      </TestWrapper>
    );

    const unsaveButton = screen.getByRole('button', { name: /saved/i });
    await user.click(unsaveButton);

    await waitFor(() => {
      expect(mockDeleteItinerary).toHaveBeenCalledWith(savedItinerary.id);
    });

    // Button should show unsaved state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save itinerary/i })).toBeInTheDocument();
    });
  });

  it('handles share itinerary action', async () => {
    const user = userEvent.setup();
    mockShareItinerary.mockResolvedValue({ shareUrl: 'https://example.com/share/123' });

    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const shareButton = screen.getByRole('button', { name: /share/i });
    await user.click(shareButton);

    // Should open share dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Share Itinerary')).toBeInTheDocument();

    // Click copy link button
    const copyButton = screen.getByRole('button', { name: /copy link/i });
    await user.click(copyButton);

    await waitFor(() => {
      expect(mockShareItinerary).toHaveBeenCalledWith(mockItinerary.id);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/share/123');
    });

    // Should show success message
    expect(screen.getByText('Link copied to clipboard!')).toBeInTheDocument();
  });

  it('navigates to detailed view when view details is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const viewDetailsButton = screen.getByRole('button', { name: /view details/i });
    await user.click(viewDetailsButton);

    expect(mockNavigate).toHaveBeenCalledWith(`/itinerary/${mockItinerary.id}`);
  });

  it('shows loading states for actions', async () => {
    const user = userEvent.setup();
    mockSaveItinerary.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const saveButton = screen.getByRole('button', { name: /save itinerary/i });
    await user.click(saveButton);

    // Should show loading state
    expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('handles error states gracefully', async () => {
    const user = userEvent.setup();
    mockSaveItinerary.mockRejectedValue(new Error('Failed to save'));

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const saveButton = screen.getByRole('button', { name: /save itinerary/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to save itinerary')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('displays activity preview correctly', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} showPreview={true} />
      </TestWrapper>
    );

    expect(screen.getByText('Day 1: Arrival & Iconic Paris')).toBeInTheDocument();
    expect(screen.getByText('Eiffel Tower Visit')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('3h')).toBeInTheDocument();
    expect(screen.getByText('$29')).toBeInTheDocument();
  });

  it('handles compact view mode', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} compact={true} />
      </TestWrapper>
    );

    // Should show essential information only
    expect(screen.getByText('5-Day Paris Adventure')).toBeInTheDocument();
    expect(screen.getByText('$2,500')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();

    // Should not show detailed information in compact mode
    expect(screen.queryByText('A perfect blend of culture, cuisine, and iconic sights')).not.toBeInTheDocument();
  });

  it('shows confidence score with appropriate color coding', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const confidenceElement = screen.getByText('85% confidence');
    expect(confidenceElement).toBeInTheDocument();
    
    // High confidence should have success color
    expect(confidenceElement.closest('.confidence-high')).toBeInTheDocument();
  });

  it('displays low confidence warning', () => {
    const lowConfidenceItinerary = {
      ...mockItinerary,
      totalBudget: {
        ...mockItinerary.totalBudget,
        confidence: 0.3
      }
    };

    render(
      <TestWrapper>
        <ItineraryCard itinerary={lowConfidenceItinerary} />
      </TestWrapper>
    );

    const confidenceElement = screen.getByText('30% confidence');
    expect(confidenceElement).toBeInTheDocument();
    
    // Low confidence should have warning color
    expect(confidenceElement.closest('.confidence-low')).toBeInTheDocument();
    expect(screen.getByText(/this itinerary may need refinement/i)).toBeInTheDocument();
  });

  it('handles keyboard navigation correctly', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Tab through interactive elements
    await user.tab();
    expect(screen.getByRole('button', { name: /save itinerary/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: /share/i })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: /view details/i })).toHaveFocus();

    // Enter key should trigger view details
    await user.keyboard('{Enter}');
    expect(mockNavigate).toHaveBeenCalledWith(`/itinerary/${mockItinerary.id}`);
  });

  it('has proper accessibility attributes', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('aria-label', 'Itinerary: 5-Day Paris Adventure');

    const saveButton = screen.getByRole('button', { name: /save itinerary/i });
    expect(saveButton).toHaveAttribute('aria-describedby');

    const shareButton = screen.getByRole('button', { name: /share/i });
    expect(shareButton).toHaveAttribute('aria-describedby');

    // Budget section should have proper labeling
    const budgetSection = screen.getByTestId('budget-section');
    expect(budgetSection).toHaveAttribute('aria-label', 'Budget: $2,500 USD');
  });

  it('displays generation metadata when expanded', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const expandButton = screen.getByRole('button', { name: /show more/i });
    await user.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Generated by: claude-3-haiku-20240307')).toBeInTheDocument();
      expect(screen.getByText('Tokens used: 3,500')).toBeInTheDocument();
      expect(screen.getByText(/generated on/i)).toBeInTheDocument();
    });
  });

  it('handles responsive layout correctly', () => {
    // Mock window resize
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768, // Tablet breakpoint
    });

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const card = screen.getByRole('article');
    expect(card).toHaveClass('responsive-card');
  });

  it('shows travel tips in collapsed format initially', () => {
    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    // Should show tip count but not all tips
    expect(screen.getByText('4 travel tips')).toBeInTheDocument();
    expect(screen.queryByText('Learn basic French phrases')).not.toBeInTheDocument();
  });

  it('expands travel tips when clicked', async () => {
    const user = userEvent.setup();

    render(
      <TestWrapper>
        <ItineraryCard itinerary={mockItinerary} />
      </TestWrapper>
    );

    const tipsSection = screen.getByText('4 travel tips');
    await user.click(tipsSection);

    await waitFor(() => {
      expect(screen.getByText('Learn basic French phrases')).toBeInTheDocument();
      expect(screen.getByText('Validate metro tickets')).toBeInTheDocument();
      expect(screen.getByText('Greet shopkeepers')).toBeInTheDocument();
      expect(screen.getByText('Watch for pickpockets')).toBeInTheDocument();
    });
  });
});