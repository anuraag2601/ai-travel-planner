import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ClaudeService, ItineraryGenerationParams } from '../../services/external/claudeService.js';
import { AmadeusService } from '../../services/external/amadeusService.js';

describe('Itinerary Generation Edge Cases', () => {
  let claudeService: ClaudeService;
  let amadeusService: AmadeusService;

  beforeEach(() => {
    jest.clearAllMocks();
    claudeService = new ClaudeService();
    amadeusService = new AmadeusService();
  });

  describe('Budget Constraint Edge Cases', () => {
    it('should handle extremely low budget constraints', async () => {
      const lowBudgetParams: ItineraryGenerationParams = {
        destination: 'Paris, France',
        duration: 7,
        startDate: '2024-12-25',
        endDate: '2024-12-31',
        travelers: { adults: 2, children: 0 },
        budget: {
          total: 50, // Extremely low budget
          currency: 'USD',
          categories: {
            accommodation: 20,
            activities: 10,
            food: 15,
            transportation: 5
          }
        },
        preferences: {
          interests: ['free activities', 'budget travel'],
          pace: 'relaxed',
          accommodationType: 'hostel',
          diningPreferences: ['street food', 'self-catering'],
          activityTypes: ['free', 'walking tours'],
          accessibility: { wheelchair: false, mobility: 'full' }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: [],
          budgetConstraints: {
            maxMealCost: 5,
            maxActivityCost: 5
          }
        }
      };

      // Mock successful response with budget-appropriate recommendations
      const mockLowBudgetItinerary = {
        overview: {
          title: 'Budget Paris Adventure',
          description: 'Explore Paris on a shoestring budget',
          highlights: ['Free museum days', 'Walking tours', 'Picnics in parks'],
          themes: ['Budget travel', 'Free activities']
        },
        totalBudget: {
          estimated: 50,
          currency: 'USD',
          breakdown: {
            accommodation: 20,
            activities: 0, // Free activities
            food: 25,
            transportation: 5
          },
          confidence: 0.7
        },
        dailyItinerary: [{
          day: 1,
          date: '2024-12-25',
          theme: 'Free Paris Discovery',
          location: 'Central Paris',
          activities: [{
            time: '10:00',
            duration: 180,
            type: 'sightseeing',
            title: 'Free Walking Tour',
            description: 'Explore Paris with a free walking tour',
            location: { name: 'Notre-Dame area', address: 'Place Jean-Paul II' },
            cost: { amount: 0, currency: 'USD', priceType: 'free' },
            bookingInfo: { required: false },
            accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
            tips: ['Tip guide if you enjoyed the tour'],
            alternatives: ['Self-guided walking route']
          }],
          meals: [{
            time: '12:30',
            type: 'lunch',
            restaurant: {
              name: 'Local Bakery',
              cuisine: 'French',
              location: 'Latin Quarter',
              priceRange: '$',
              atmosphere: 'Casual'
            },
            estimatedCost: { amount: 4, currency: 'USD' },
            reservationInfo: { required: false },
            highlights: ['Fresh bread', 'Affordable pastries'],
            dietaryOptions: ['Vegetarian options']
          }],
          transportation: [],
          dailyBudget: {
            estimated: 7,
            breakdown: {
              activities: 0,
              food: 4,
              transportation: 0,
              miscellaneous: 3
            }
          },
          tips: ['Bring water bottle', 'Pack snacks'],
          alternatives: []
        }],
        travelTips: {
          general: ['Many museums are free on first Sundays'],
          cultural: ['Parisians appreciate effort to speak French'],
          practical: ['Walking is often faster than metro'],
          safety: ['Keep belongings secure in tourist areas']
        },
        emergencyInfo: {
          emergency: '112',
          police: '17',
          medical: '15',
          embassy: { us: '+33 1 43 12 22 22' },
          hospitals: []
        },
        recommendations: {
          restaurants: [],
          activities: [],
          shopping: []
        },
        localInsights: {
          culture: [],
          etiquette: [],
          language: { basicPhrases: {}, usefulWords: {} },
          transportation: {
            publicTransport: '',
            taxiApps: [],
            walkingAreas: []
          },
          weather: {
            general: '',
            clothing: [],
            seasonalTips: []
          }
        },
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.7,
          tokensUsed: 2000,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Mock Redis and Anthropic
      const mockRedisService = { get: jest.fn().mockResolvedValue(null), setex: jest.fn() };
      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(mockLowBudgetItinerary) }],
            usage: { input_tokens: 1000, output_tokens: 1000 }
          })
        }
      };

      // Mock the services
      claudeService['redis'] = mockRedisService as any;
      claudeService['client'] = mockAnthropicClient as any;

      const result = await claudeService.generateItinerary(lowBudgetParams);

      expect(result.totalBudget.estimated).toBeLessThanOrEqual(lowBudgetParams.budget.total);
      expect(result.dailyItinerary[0].activities[0].cost.amount).toBe(0);
      expect(result.generationMetadata.confidence).toBeGreaterThan(0.5);
    });

    it('should handle budget misallocation scenarios', async () => {
      const misallocatedBudgetParams: ItineraryGenerationParams = {
        destination: 'Tokyo, Japan',
        duration: 3,
        startDate: '2024-06-01',
        endDate: '2024-06-03',
        travelers: { adults: 1, children: 0 },
        budget: {
          total: 1000,
          currency: 'USD',
          categories: {
            accommodation: 50, // Too low for Tokyo
            activities: 800, // Too high proportion
            food: 100,
            transportation: 50
          }
        },
        preferences: {
          interests: ['luxury experiences'],
          pace: 'fast',
          accommodationType: 'luxury hotel',
          diningPreferences: ['fine dining'],
          activityTypes: ['exclusive'],
          accessibility: { wheelchair: false, mobility: 'full' }
        },
        constraints: {
          avoidAreas: [],
          mustVisit: ['Tokyo Disneyland'],
          budgetConstraints: {
            maxMealCost: 100,
            maxActivityCost: 200
          }
        }
      };

      // Mock realistic budget reallocation
      const mockReallocatedItinerary = {
        overview: {
          title: 'Tokyo Luxury Experience (Budget Adjusted)',
          description: 'Premium Tokyo experience with realistic budget allocation',
          highlights: ['Disneyland visit', 'High-end dining', 'Luxury shopping'],
          themes: ['Luxury', 'Culture']
        },
        totalBudget: {
          estimated: 1000,
          currency: 'USD',
          breakdown: {
            accommodation: 400, // Realistically adjusted
            activities: 300,    // Reduced from 800
            food: 200,          // Increased
            transportation: 100  // Increased
          },
          confidence: 0.6 // Lower confidence due to budget constraints
        },
        dailyItinerary: [{
          day: 1,
          date: '2024-06-01',
          theme: 'Tokyo Arrival & Luxury Shopping',
          location: 'Ginza',
          activities: [{
            time: '14:00',
            duration: 240,
            type: 'shopping',
            title: 'Ginza Luxury Shopping',
            description: 'Explore high-end boutiques in Ginza',
            location: { name: 'Ginza District', address: 'Ginza, Chuo City, Tokyo' },
            cost: { amount: 100, currency: 'USD', priceType: 'estimated' },
            bookingInfo: { required: false },
            accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
            tips: ['Many stores offer tax-free shopping'],
            alternatives: ['Harajuku for alternative fashion']
          }],
          meals: [{
            time: '19:00',
            type: 'dinner',
            restaurant: {
              name: 'Sukiyabashi Jiro (Alternative)',
              cuisine: 'Japanese',
              location: 'Ginza',
              priceRange: '$$$',
              atmosphere: 'High-end sushi bar'
            },
            estimatedCost: { amount: 80, currency: 'USD' },
            reservationInfo: { required: true, advanceNotice: '1 month' },
            highlights: ['World-class sushi', 'Michelin starred'],
            dietaryOptions: ['Limited vegetarian options']
          }],
          transportation: [{
            from: 'Narita Airport',
            to: 'Ginza Hotel',
            method: 'taxi',
            duration: 60,
            cost: { amount: 50, currency: 'USD' },
            instructions: 'Take taxi from airport',
            alternatives: ['Narita Express train']
          }],
          dailyBudget: {
            estimated: 350,
            breakdown: {
              activities: 100,
              food: 80,
              transportation: 50,
              miscellaneous: 120
            }
          },
          tips: ['Budget is tight - consider alternatives'],
          alternatives: [{
            type: 'restaurant',
            original: 'Sukiyabashi Jiro',
            alternative: 'Conveyor belt sushi',
            reason: 'More budget-friendly option'
          }]
        }],
        travelTips: {
          general: ['Tokyo is expensive - budget carefully'],
          cultural: ['Bowing is important in Japanese culture'],
          practical: ['Get a JR Pass for transportation'],
          safety: ['Tokyo is very safe']
        },
        emergencyInfo: {
          emergency: '110',
          police: '110',
          medical: '119',
          embassy: { us: '+81 3 3224 5000' },
          hospitals: []
        },
        recommendations: {
          restaurants: [],
          activities: [],
          shopping: []
        },
        localInsights: {
          culture: [],
          etiquette: [],
          language: { basicPhrases: {}, usefulWords: {} },
          transportation: {
            publicTransport: '',
            taxiApps: [],
            walkingAreas: []
          },
          weather: {
            general: '',
            clothing: [],
            seasonalTips: []
          }
        },
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.6,
          tokensUsed: 2500,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Mock services
      const mockRedisService = { get: jest.fn().mockResolvedValue(null), setex: jest.fn() };
      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(mockReallocatedItinerary) }],
            usage: { input_tokens: 1500, output_tokens: 1000 }
          })
        }
      };

      claudeService['redis'] = mockRedisService as any;
      claudeService['client'] = mockAnthropicClient as any;

      const result = await claudeService.generateItinerary(misallocatedBudgetParams);

      // Verify budget reallocation
      expect(result.totalBudget.breakdown.accommodation).toBeGreaterThan(50);
      expect(result.totalBudget.breakdown.activities).toBeLessThan(800);
      expect(result.generationMetadata.confidence).toBeLessThan(0.8); // Lower confidence due to adjustments
      expect(result.dailyItinerary[0].alternatives).toHaveLength(1); // Should suggest alternatives
    });
  });

  describe('Complex Traveler Scenarios', () => {
    it('should handle multi-generational family with accessibility needs', async () => {
      const complexFamilyParams: ItineraryGenerationParams = {
        destination: 'Rome, Italy',
        duration: 5,
        startDate: '2024-08-15',
        endDate: '2024-08-19',
        travelers: { adults: 4, children: 2 },
        budget: {
          total: 4000,
          currency: 'USD',
          categories: {
            accommodation: 1600,
            activities: 1200,
            food: 800,
            transportation: 400
          }
        },
        preferences: {
          interests: ['history', 'family-friendly', 'accessible tours'],
          pace: 'relaxed',
          accommodationType: 'family hotel',
          diningPreferences: ['kid-friendly', 'accessible restaurants'],
          activityTypes: ['educational', 'accessible'],
          accessibility: {
            wheelchair: true,
            mobility: 'limited'
          }
        },
        constraints: {
          avoidAreas: ['crowded tourist traps'],
          mustVisit: ['Colosseum', 'Vatican City'],
          budgetConstraints: {
            maxMealCost: 30, // Per person
            maxActivityCost: 50 // Per person
          }
        }
      };

      const mockFamilyItinerary = {
        overview: {
          title: 'Accessible Rome Family Adventure',
          description: 'Family-friendly exploration of Rome with accessibility considerations',
          highlights: ['Wheelchair accessible Colosseum tour', 'Vatican skip-the-line access', 'Family restaurants'],
          themes: ['Family travel', 'Accessibility', 'History']
        },
        totalBudget: {
          estimated: 3800,
          currency: 'USD',
          breakdown: {
            accommodation: 1500,
            activities: 1000,
            food: 900,
            transportation: 400
          },
          confidence: 0.85
        },
        dailyItinerary: [{
          day: 1,
          date: '2024-08-15',
          theme: 'Arrival and Gentle Introduction',
          location: 'Central Rome',
          activities: [{
            time: '15:00',
            duration: 120,
            type: 'sightseeing',
            title: 'Wheelchair Accessible Colosseum Tour',
            description: 'Skip-the-line tour with wheelchair access and family guide',
            location: { name: 'Colosseum', address: 'Piazza del Colosseo, 1, 00184 Roma RM' },
            cost: { amount: 180, currency: 'USD', priceType: 'fixed' }, // Family group price
            bookingInfo: {
              required: true,
              website: 'https://colosseum-tickets.com',
              advanceNotice: '48 hours'
            },
            accessibility: {
              wheelchairAccessible: true,
              mobilityFriendly: true,
              notes: 'Elevator access to main level, accessible restrooms available'
            },
            tips: ['Bring water for children', 'Tour includes rest stops'],
            alternatives: ['Virtual reality Colosseum experience']
          }],
          meals: [{
            time: '18:30',
            type: 'dinner',
            restaurant: {
              name: 'Trattoria da Nennella',
              cuisine: 'Italian',
              location: 'Near Colosseum',
              priceRange: '$$',
              atmosphere: 'Family-friendly trattoria'
            },
            estimatedCost: { amount: 120, currency: 'USD' }, // For family of 6
            reservationInfo: {
              required: true,
              phone: '+39 06 123 4567'
            },
            highlights: ['Kid-friendly pasta dishes', 'High chairs available'],
            dietaryOptions: ['Gluten-free pasta', 'Vegetarian options']
          }],
          transportation: [{
            from: 'Airport',
            to: 'Hotel',
            method: 'accessible taxi',
            duration: 45,
            cost: { amount: 60, currency: 'USD' },
            instructions: 'Pre-booked accessible taxi van',
            alternatives: ['Accessible airport shuttle']
          }],
          dailyBudget: {
            estimated: 400,
            breakdown: {
              activities: 180,
              food: 120,
              transportation: 60,
              miscellaneous: 40
            }
          },
          tips: ['Book accessible transport in advance', 'Carry accessibility certificates'],
          alternatives: [{
            type: 'activity',
            original: 'Colosseum ground tour',
            alternative: 'Audio guide tour',
            reason: 'More flexible for family with different mobility needs'
          }]
        }],
        travelTips: {
          general: ['Rome has many cobblestone streets - plan accordingly'],
          cultural: ['Romans are family-friendly'],
          practical: ['Many museums offer accessibility services'],
          safety: ['Keep children close in crowded areas']
        },
        emergencyInfo: {
          emergency: '112',
          police: '113',
          medical: '118',
          embassy: { us: '+39 06 46741' },
          hospitals: [{
            name: 'Bambino Gesù Children\'s Hospital',
            phone: '+39 06 68591',
            address: 'Piazza di Sant\'Onofrio, 4, 00165 Roma RM'
          }]
        },
        recommendations: {
          restaurants: [{
            name: 'Ginger',
            cuisine: 'Italian',
            priceRange: '$$',
            location: 'Trastevere',
            specialties: ['Accessible entrance', 'Kids menu'],
            reservationRequired: true
          }],
          activities: [{
            name: 'Villa Borghese Park',
            type: 'outdoor',
            duration: 180,
            cost: 0,
            difficulty: 'easy',
            bestTime: 'Morning',
            bookingRequired: false
          }],
          shopping: []
        },
        localInsights: {
          culture: ['Family is very important in Italian culture'],
          etiquette: ['Children are welcome in most places'],
          language: {
            basicPhrases: { 
              'wheelchair access': 'accesso per sedia a rotelle',
              'elevator': 'ascensore'
            },
            usefulWords: { 
              'accessible': 'accessibile',
              'children': 'bambini'
            }
          },
          transportation: {
            publicTransport: 'Metro has limited accessibility - buses are better',
            taxiApps: ['MyTaxi (accessible option available)'],
            walkingAreas: ['Villa Borghese', 'Trastevere (some areas)']
          },
          weather: {
            general: 'Hot in August - stay hydrated',
            clothing: ['Sun hats for children', 'Comfortable walking shoes'],
            seasonalTips: ['Many Romans vacation in August - less crowded']
          }
        },
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.85,
          tokensUsed: 3000,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Mock services
      const mockRedisService = { get: jest.fn().mockResolvedValue(null), setex: jest.fn() };
      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(mockFamilyItinerary) }],
            usage: { input_tokens: 2000, output_tokens: 1000 }
          })
        }
      };

      claudeService['redis'] = mockRedisService as any;
      claudeService['client'] = mockAnthropicClient as any;

      const result = await claudeService.generateItinerary(complexFamilyParams);

      // Verify accessibility considerations
      expect(result.dailyItinerary[0].activities[0].accessibility.wheelchairAccessible).toBe(true);
      expect(result.dailyItinerary[0].activities[0].accessibility.notes).toContain('accessible');
      expect(result.emergencyInfo.hospitals).toHaveLength(1);
      expect(result.emergencyInfo.hospitals[0].name).toContain('Children');
      
      // Verify family-friendly aspects
      expect(result.dailyItinerary[0].meals[0].highlights).toContain('High chairs available');
      expect(result.recommendations.activities[0].difficulty).toBe('easy');
      
      // Verify proper budgeting for larger group
      expect(result.dailyItinerary[0].dailyBudget.estimated).toBeGreaterThan(300);
    });

    it('should handle solo business traveler with tight schedule', async () => {
      const businessTravelerParams: ItineraryGenerationParams = {
        destination: 'Singapore',
        duration: 2,
        startDate: '2024-09-15',
        endDate: '2024-09-16',
        travelers: { adults: 1, children: 0 },
        budget: {
          total: 2000,
          currency: 'USD',
          categories: {
            accommodation: 800,
            activities: 400,
            food: 400,
            transportation: 400
          }
        },
        preferences: {
          interests: ['business networking', 'efficient travel', 'quality dining'],
          pace: 'fast',
          accommodationType: 'business hotel',
          diningPreferences: ['business dining', 'quick meals'],
          activityTypes: ['business-friendly', 'efficient'],
          accessibility: { wheelchair: false, mobility: 'full' }
        },
        constraints: {
          avoidAreas: ['tourist crowds'],
          mustVisit: ['Marina Bay', 'Financial District'],
          budgetConstraints: {
            maxMealCost: 100,
            maxActivityCost: 150
          }
        },
        context: {
          selectedFlights: [{
            departure: '08:00',
            arrival: '14:00',
            airline: 'Singapore Airlines'
          }],
          selectedHotels: [{
            name: 'Marina Bay Sands',
            location: 'Marina Bay',
            checkIn: '15:00',
            checkOut: '12:00'
          }]
        }
      };

      const mockBusinessItinerary = {
        overview: {
          title: 'Efficient Singapore Business Trip',
          description: 'Maximized business travel with premium experiences',
          highlights: ['Marina Bay business district', 'Networking dinner', 'Efficient airport transfers'],
          themes: ['Business efficiency', 'Premium dining', 'Networking']
        },
        totalBudget: {
          estimated: 1900,
          currency: 'USD',
          breakdown: {
            accommodation: 800,
            activities: 300,
            food: 450,
            transportation: 350
          },
          confidence: 0.9
        },
        dailyItinerary: [{
          day: 1,
          date: '2024-09-15',
          theme: 'Arrival and Business Networking',
          location: 'Marina Bay',
          activities: [{
            time: '16:00',
            duration: 90,
            type: 'business',
            title: 'Marina Bay Business Walk',
            description: 'Quick tour of financial district and networking spots',
            location: { name: 'Marina Bay Financial Centre', address: '8 Marina Boulevard' },
            cost: { amount: 0, currency: 'USD', priceType: 'free' },
            bookingInfo: { required: false },
            accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
            tips: ['Bring business cards', 'Professional attire expected'],
            alternatives: ['Rooftop bar networking']
          }],
          meals: [{
            time: '19:30',
            type: 'dinner',
            restaurant: {
              name: 'CE LA VIE',
              cuisine: 'Modern Asian',
              location: 'Marina Bay Sands SkyPark',
              priceRange: '$$$$',
              atmosphere: 'Business dining with city views'
            },
            estimatedCost: { amount: 150, currency: 'USD' },
            reservationInfo: {
              required: true,
              website: 'https://www.celavi.com.sg',
              advanceNotice: '24 hours'
            },
            highlights: ['Skyline views', 'Business atmosphere', 'Premium cocktails'],
            dietaryOptions: ['Various dietary accommodations']
          }],
          transportation: [{
            from: 'Changi Airport',
            to: 'Marina Bay Sands',
            method: 'taxi',
            duration: 25,
            cost: { amount: 40, currency: 'USD' },
            instructions: 'Direct taxi to hotel - fastest option',
            alternatives: ['Airport shuttle', 'Grab car']
          }],
          dailyBudget: {
            estimated: 250,
            breakdown: {
              activities: 0,
              food: 150,
              transportation: 40,
              miscellaneous: 60
            }
          },
          tips: ['Singapore is very efficient', 'Contactless payments preferred'],
          alternatives: []
        }],
        travelTips: {
          general: ['Singapore is extremely efficient for business travel'],
          cultural: ['Punctuality is highly valued'],
          practical: ['Excellent English proficiency', 'World-class infrastructure'],
          safety: ['Very safe for solo travelers']
        },
        emergencyInfo: {
          emergency: '999',
          police: '999',
          medical: '995',
          embassy: { us: '+65 6476 9100' },
          hospitals: []
        },
        recommendations: {
          restaurants: [{
            name: 'Long Bar',
            cuisine: 'International',
            priceRange: '$$$',
            location: 'Raffles Hotel',
            specialties: ['Singapore Sling', 'Business networking'],
            reservationRequired: false
          }],
          activities: [{
            name: 'Gardens by the Bay',
            type: 'sightseeing',
            duration: 60,
            cost: 20,
            difficulty: 'easy',
            bestTime: 'Evening',
            bookingRequired: false
          }],
          shopping: []
        },
        localInsights: {
          culture: ['Multicultural business environment'],
          etiquette: ['Business cards exchanged with both hands'],
          language: {
            basicPhrases: { 'business meeting': 'business meeting' },
            usefulWords: { 'efficient': 'efficient' }
          },
          transportation: {
            publicTransport: 'MRT is extremely efficient',
            taxiApps: ['Grab', 'ComfortDelGro'],
            walkingAreas: ['Marina Bay', 'Orchard Road']
          },
          weather: {
            general: 'Tropical climate - indoor venues are air-conditioned',
            clothing: ['Business attire', 'Light jacket for AC'],
            seasonalTips: ['September is relatively dry']
          }
        },
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.9,
          tokensUsed: 2200,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Mock services
      const mockRedisService = { get: jest.fn().mockResolvedValue(null), setex: jest.fn() };
      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(mockBusinessItinerary) }],
            usage: { input_tokens: 1800, output_tokens: 800 }
          })
        }
      };

      claudeService['redis'] = mockRedisService as any;
      claudeService['client'] = mockAnthropicClient as any;

      const result = await claudeService.generateItinerary(businessTravelerParams);

      // Verify business-focused aspects
      expect(result.overview.themes).toContain('Business efficiency');
      expect(result.dailyItinerary[0].activities[0].tips).toContain('Bring business cards');
      expect(result.dailyItinerary[0].meals[0].restaurant.atmosphere).toContain('Business');
      expect(result.generationMetadata.confidence).toBeGreaterThanOrEqual(0.85);
      
      // Verify efficiency focus
      expect(result.dailyItinerary[0].transportation[0].duration).toBeLessThanOrEqual(30);
      expect(result.localInsights.culture).toContain('Multicultural business environment');
    });
  });

  describe('Extreme Weather and Seasonal Edge Cases', () => {
    it('should handle monsoon season travel planning', async () => {
      const monsoonParams: ItineraryGenerationParams = {
        destination: 'Mumbai, India',
        duration: 4,
        startDate: '2024-07-15', // Peak monsoon season
        endDate: '2024-07-18',
        travelers: { adults: 2, children: 0 },
        budget: {
          total: 800,
          currency: 'USD',
          categories: {
            accommodation: 300,
            activities: 200,
            food: 200,
            transportation: 100
          }
        },
        preferences: {
          interests: ['culture', 'indoor activities', 'monsoon experiences'],
          pace: 'moderate',
          accommodationType: 'hotel',
          diningPreferences: ['local cuisine', 'covered restaurants'],
          activityTypes: ['indoor', 'cultural'],
          accessibility: { wheelchair: false, mobility: 'full' }
        },
        constraints: {
          avoidAreas: ['flood-prone areas'],
          mustVisit: ['Gateway of India'],
          budgetConstraints: {
            maxMealCost: 25,
            maxActivityCost: 40
          }
        },
        context: {
          weatherData: {
            temperature: 28,
            humidity: 95,
            rainfall: 'heavy',
            conditions: 'monsoon season'
          }
        }
      };

      const mockMonsoonItinerary = {
        overview: {
          title: 'Mumbai Monsoon Cultural Experience',
          description: 'Embrace Mumbai\'s monsoon season with indoor cultural experiences',
          highlights: ['Museum visits', 'Covered markets', 'Monsoon photography'],
          themes: ['Monsoon culture', 'Indoor exploration', 'Local experiences']
        },
        totalBudget: {
          estimated: 750,
          currency: 'USD',
          breakdown: {
            accommodation: 300,
            activities: 150,
            food: 200,
            transportation: 100
          },
          confidence: 0.75
        },
        dailyItinerary: [{
          day: 1,
          date: '2024-07-15',
          theme: 'Indoor Cultural Exploration',
          location: 'South Mumbai',
          activities: [{
            time: '10:00',
            duration: 180,
            type: 'museum',
            title: 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya',
            description: 'Explore Mumbai\'s premier museum during monsoon',
            location: { 
              name: 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya', 
              address: '159-161, Mahatma Gandhi Road, Fort' 
            },
            cost: { amount: 15, currency: 'USD', priceType: 'fixed' },
            bookingInfo: { 
              required: false,
              website: 'https://csmvs.in'
            },
            accessibility: { wheelchairAccessible: true, mobilityFriendly: true },
            tips: ['Perfect rainy day activity', 'Air-conditioned comfort'],
            alternatives: ['Dr. Bhau Daji Lad Museum']
          }],
          meals: [{
            time: '13:00',
            type: 'lunch',
            restaurant: {
              name: 'Trishna',
              cuisine: 'Seafood',
              location: 'Fort district',
              priceRange: '$$',
              atmosphere: 'Cozy indoor restaurant'
            },
            estimatedCost: { amount: 40, currency: 'USD' },
            reservationInfo: { required: true },
            highlights: ['Fresh monsoon seafood', 'Covered seating'],
            dietaryOptions: ['Vegetarian options available']
          }],
          transportation: [{
            from: 'Hotel',
            to: 'Museum',
            method: 'taxi',
            duration: 20,
            cost: { amount: 8, currency: 'USD' },
            instructions: 'Use app-based taxi during monsoon',
            alternatives: ['Covered walkways where possible']
          }],
          dailyBudget: {
            estimated: 80,
            breakdown: {
              activities: 15,
              food: 40,
              transportation: 15,
              miscellaneous: 10
            }
          },
          tips: [
            'Carry waterproof bags',
            'Wear quick-dry clothes',
            'Keep extra footwear',
            'Avoid low-lying areas during heavy rain'
          ],
          alternatives: [{
            type: 'activity',
            original: 'Outdoor sightseeing',
            alternative: 'Shopping mall exploration',
            reason: 'Weather-dependent backup plan'
          }]
        }],
        travelTips: {
          general: [
            'Monsoon is beautiful but challenging',
            'Transportation may be delayed',
            'Book covered accommodations'
          ],
          cultural: [
            'Monsoons are celebrated in Indian culture',
            'Many festivals happen during monsoon'
          ],
          practical: [
            'Carry umbrella and raincoat',
            'Waterproof phone covers essential',
            'Book indoor activities in advance'
          ],
          safety: [
            'Avoid walking in flooded areas',
            'Stay updated on weather alerts',
            'Keep emergency contacts handy'
          ]
        },
        emergencyInfo: {
          emergency: '100',
          police: '100',
          medical: '102',
          embassy: { us: '+91 22 6672 4000' },
          hospitals: []
        },
        recommendations: {
          restaurants: [],
          activities: [],
          shopping: []
        },
        localInsights: {
          culture: ['Monsoon brings out Mumbai\'s resilient spirit'],
          etiquette: ['Mumbaikars are helpful during monsoon'],
          language: {
            basicPhrases: { 'heavy rain': 'तेज़ बारिश' },
            usefulWords: { 'umbrella': 'छाता' }
          },
          transportation: {
            publicTransport: 'Local trains may be delayed during heavy rain',
            taxiApps: ['Uber', 'Ola', 'Meru'],
            walkingAreas: ['Covered shopping areas', 'Malls']
          },
          weather: {
            general: 'Heavy rainfall expected, humid conditions',
            clothing: [
              'Waterproof jacket',
              'Quick-dry pants',
              'Closed-toe shoes',
              'Extra socks'
            ],
            seasonalTips: [
              'Embrace the monsoon magic',
              'Hot tea and pakoras are monsoon traditions',
              'Photography opportunities unique to monsoon'
            ]
          }
        },
        generationMetadata: {
          model: 'claude-3-sonnet',
          confidence: 0.75,
          tokensUsed: 2800,
          generatedAt: new Date().toISOString(),
          version: '1.0'
        }
      };

      // Mock services
      const mockRedisService = { get: jest.fn().mockResolvedValue(null), setex: jest.fn() };
      const mockAnthropicClient = {
        messages: {
          create: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(mockMonsoonItinerary) }],
            usage: { input_tokens: 2000, output_tokens: 1500 }
          })
        }
      };

      claudeService['redis'] = mockRedisService as any;
      claudeService['client'] = mockAnthropicClient as any;

      const result = await claudeService.generateItinerary(monsoonParams);

      // Verify weather-appropriate planning
      expect(result.dailyItinerary[0].activities[0].type).toBe('museum');
      expect(result.dailyItinerary[0].tips).toContain('Carry waterproof bags');
      expect(result.localInsights.weather.clothing).toContain('Waterproof jacket');
      expect(result.travelTips.safety).toContain('Avoid walking in flooded areas');
      
      // Verify monsoon-specific considerations
      expect(result.overview.themes).toContain('Monsoon culture');
      expect(result.dailyItinerary[0].alternatives[0].reason).toContain('Weather-dependent');
    });
  });
});