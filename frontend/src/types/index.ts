// Common types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  requestId: string;
}

// User types
export interface User {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  verified: boolean;
  preferences: UserPreferences;
  travelHistory: TravelHistory;
}

export interface UserPreferences {
  currency: string;
  language: string;
  timezone: string;
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
  timeFormat: '12h' | '24h';
  notifications: NotificationPreferences;
  travel: TravelPreferences;
  accessibility: AccessibilityPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  priceAlerts: boolean;
  itineraryUpdates: boolean;
  marketingEmails: boolean;
}

export interface TravelPreferences {
  preferredClass: 'economy' | 'premium-economy' | 'business' | 'first';
  seatPreference: 'window' | 'aisle' | 'middle' | 'any';
  mealPreference: 'standard' | 'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'gluten-free';
  budgetRange: {
    min: number;
    max: number;
    currency: string;
  };
  accommodationTypes: Array<'hotel' | 'apartment' | 'hostel' | 'resort' | 'bed-breakfast'>;
  activityInterests: Array<'culture' | 'adventure' | 'relaxation' | 'food' | 'nightlife' | 'nature' | 'history' | 'art' | 'sports'>;
  travelPace: 'relaxed' | 'moderate' | 'fast';
  groupSize: 'solo' | 'couple' | 'family' | 'group';
}

export interface AccessibilityPreferences {
  wheelchairAccess: boolean;
  visualImpairment: boolean;
  hearingImpairment: boolean;
  mobilityAssistance: boolean;
  dietaryRestrictions: string[];
}

export interface TravelHistory {
  totalTrips: number;
  totalCountriesVisited: number;
  totalCitiesVisited: number;
  favoriteDestinations: string[];
  totalMilesFlown: number;
  totalNightsStayed: number;
  averageTripDuration: number;
  preferredSeasons: string[];
  lastTripDate?: string;
}

// Search types
export interface FlightSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: {
    adults: number;
    children: number;
    infants: number;
  };
  preferences: {
    class: 'economy' | 'premium-economy' | 'business' | 'first';
    directFlights: boolean;
    maxStops: number;
    preferredAirlines: string[];
    maxPrice?: number;
    sortBy: 'price' | 'duration' | 'departure_time';
  };
}

export interface FlightResult {
  flightId: string;
  totalPrice: {
    amount: number;
    currency: string;
  };
  outbound: FlightSegment;
  return?: FlightSegment;
  amenities: FlightAmenities;
  bookingUrl: string;
  lastUpdated: string;
}

export interface FlightSegment {
  departure: {
    airport: string;
    city: string;
    time: string;
    terminal?: string;
  };
  arrival: {
    airport: string;
    city: string;
    time: string;
    terminal?: string;
  };
  duration: string;
  stops: number;
  airline: string;
  flightNumber: string;
  aircraft: string;
  bookingClass: string;
}

export interface FlightAmenities {
  wifiAvailable: boolean;
  mealService: boolean;
  seatSelection: boolean;
  baggageIncluded: {
    checkedBags: number;
    carryOn: number;
    personal: number;
  };
}

export interface HotelSearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: {
    adults: number;
    children: number;
    rooms: number;
  };
  preferences: {
    starRating: number[];
    amenities: string[];
    propertyTypes: string[];
    maxPrice?: number;
    sortBy: 'price' | 'rating' | 'distance';
    location?: {
      latitude: number;
      longitude: number;
      radius: number;
    };
  };
}

export interface HotelResult {
  hotelId: string;
  name: string;
  starRating: number;
  location: {
    address: string;
    latitude: number;
    longitude: number;
    distanceFromCenter: number;
    neighborhood: string;
  };
  totalPrice: {
    amount: number;
    currency: string;
    pricePerNight: number;
    taxesAndFees: number;
  };
  rooms: HotelRoom[];
  hotelAmenities: string[];
  images: string[];
  guestRating: {
    overall: number;
    cleanliness: number;
    service: number;
    location: number;
    value: number;
    totalReviews: number;
  };
  bookingUrl: string;
  lastUpdated: string;
}

export interface HotelRoom {
  roomType: string;
  bedType: string;
  maxOccupancy: number;
  roomSize: number;
  amenities: string[];
  pricePerNight: {
    amount: number;
    currency: string;
  };
  availability: string;
  cancellationPolicy: string;
}

// Itinerary types
export interface ItineraryGenerationParams {
  destination: string;
  duration: number;
  startDate: string;
  travelers: {
    adults: number;
    children: number;
  };
  budget: {
    total: number;
    currency: string;
    categories: {
      accommodation: number;
      activities: number;
      food: number;
      transportation: number;
    };
  };
  preferences: {
    interests: string[];
    pace: 'relaxed' | 'moderate' | 'fast';
    accommodationType: string;
    diningPreferences: string[];
    activityTypes: string[];
    accessibility: {
      wheelchair: boolean;
      mobility: 'full' | 'limited';
    };
  };
  constraints: {
    avoidAreas: string[];
    mustVisit: string[];
    budgetConstraints: {
      maxMealCost: number;
      maxActivityCost: number;
    };
  };
}

export interface GeneratedItinerary {
  itineraryId: string;
  destination: string;
  duration: number;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  overview: {
    title: string;
    description: string;
    highlights: string[];
  };
  totalBudget: {
    estimated: number;
    currency: string;
    breakdown: {
      accommodation: number;
      activities: number;
      food: number;
      transportation: number;
    };
  };
  dailyItinerary: DailyItinerary[];
  recommendedBookings: {
    flights: FlightResult[];
    hotels: HotelResult[];
  };
  travelTips: {
    general: string[];
    cultural: string[];
    practical: string[];
  };
  emergencyInfo: {
    emergency: string;
    police: string;
    medical: string;
    embassy: Record<string, string>;
    hospitals: Array<{
      name: string;
      phone: string;
      address: string;
    }>;
  };
  generatedAt: string;
  aiModel: string;
  customizable: boolean;
}

export interface DailyItinerary {
  day: number;
  date: string;
  theme: string;
  activities: ItineraryActivity[];
  dailyBudget: {
    spent: number;
    currency: string;
  };
  transportation: TransportationOption[];
  weatherForecast: {
    temperature: {
      high: number;
      low: number;
      unit: 'celsius' | 'fahrenheit';
    };
    condition: string;
    precipitation: number;
  };
}

export interface ItineraryActivity {
  time: string;
  type: 'arrival' | 'accommodation' | 'activity' | 'dining' | 'transportation' | 'departure';
  title: string;
  description: string;
  duration: number;
  cost: {
    amount: number;
    currency: string;
    category: string;
  };
  location: {
    name: string;
    address: string;
    coordinates: {
      latitude: number;
      longitude: number;
    };
  };
  tips: string[];
  bookingInfo?: {
    confirmationRequired: boolean;
    checkInTime?: string;
    earlyCheckIn?: string;
  };
  reservationInfo?: {
    reservationRequired: boolean;
    phone?: string;
    dressCode?: string;
  };
}

export interface TransportationOption {
  from: string;
  to: string;
  method: string;
  duration: number;
  cost: number;
}

// Location types
export interface LocationSuggestion {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  type: 'city' | 'airport' | 'landmark';
  coordinates: {
    latitude: number;
    longitude: number;
  };
  timezone: string;
  airports?: Array<{
    code: string;
    name: string;
  }>;
}

// Notification types
export interface Notification {
  id: string;
  type: 'price-alert' | 'booking-confirmation' | 'itinerary-shared' | 'trip-reminder' | 'system-update';
  title: string;
  message: string;
  icon?: string;
  imageUrl?: string;
  data: any;
  read: boolean;
  createdAt: string;
  expiresAt?: string;
  actions: NotificationAction[];
}

export interface NotificationAction {
  id: string;
  label: string;
  type: 'url' | 'deep-link' | 'api-call';
  target: string;
  style: 'primary' | 'secondary' | 'danger';
}

// WebSocket types
export interface WebSocketMessage {
  type: string;
  channel?: string;
  data: any;
  timestamp: string;
}

export interface PriceUpdateMessage extends WebSocketMessage {
  type: 'price-update';
  channel: 'flight-prices' | 'hotel-prices';
  data: {
    itemId: string;
    oldPrice: number;
    newPrice: number;
    change: number;
    changePercent: number;
    timestamp: string;
  };
}

// Redux state types
export interface RootState {
  auth: AuthState;
  user: UserState;
  search: SearchState;
  itinerary: ItineraryState;
  notifications: NotificationState;
  ui: UIState;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  loading: boolean;
  error: string | null;
}

export interface UserState {
  profile: User | null;
  preferences: UserPreferences | null;
  loading: boolean;
  error: string | null;
}

export interface SearchState {
  flights: {
    params: FlightSearchParams | null;
    results: FlightResult[];
    loading: boolean;
    error: string | null;
    totalResults: number;
    filters: any;
  };
  hotels: {
    params: HotelSearchParams | null;
    results: HotelResult[];
    loading: boolean;
    error: string | null;
    totalResults: number;
    filters: any;
  };
  locations: {
    suggestions: LocationSuggestion[];
    loading: boolean;
    error: string | null;
  };
}

export interface ItineraryState {
  current: GeneratedItinerary | null;
  list: GeneratedItinerary[];
  generating: boolean;
  loading: boolean;
  error: string | null;
  customizations: any[];
}

export interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
}

export interface UIState {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  loading: boolean;
  alerts: Array<{
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    persistent: boolean;
  }>;
}

// API Error types
export interface APIError {
  code: string;
  message: string;
  details?: any;
  statusCode: number;
}

// Form types
export interface TripFormData {
  destination: string;
  startDate: string;
  endDate: string;
  travelers: {
    adults: number;
    children: number;
    infants: number;
  };
  budget: {
    total: number;
    currency: string;
  };
  preferences: {
    interests: string[];
    pace: 'relaxed' | 'moderate' | 'fast';
    accommodationType: string[];
    activityTypes: string[];
  };
}

export interface UserProfileFormData {
  firstName: string;
  lastName: string;
  email: string;
  preferences: UserPreferences;
}

// Component prop types
export interface BaseComponentProps {
  className?: string;
  children?: React.ReactNode;
}

export interface LoadingProps extends BaseComponentProps {
  loading: boolean;
  error?: string | null;
  retry?: () => void;
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

export interface FilterProps<T = any> {
  filters: T;
  onFiltersChange: (filters: T) => void;
  loading?: boolean;
}

// Utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export default {};