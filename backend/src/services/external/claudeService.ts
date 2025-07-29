import Anthropic from '@anthropic-ai/sdk'
import { config } from '@/config/index.js'
import { logger } from '@/utils/logger.js'
import { RedisService } from '@/services/redis.js'

export interface ItineraryGenerationParams {
  destination: string
  duration: number
  startDate: string
  endDate: string
  travelers: {
    adults: number
    children: number
  }
  budget: {
    total: number
    currency: string
    categories: {
      accommodation: number
      activities: number
      food: number
      transportation: number
    }
  }
  preferences: {
    interests: string[]
    pace: 'relaxed' | 'moderate' | 'fast'
    accommodationType: string
    diningPreferences: string[]
    activityTypes: string[]
    accessibility: {
      wheelchair: boolean
      mobility: 'full' | 'limited'
    }
  }
  constraints: {
    avoidAreas: string[]
    mustVisit: string[]
    budgetConstraints: {
      maxMealCost: number
      maxActivityCost: number
    }
  }
  context?: {
    selectedFlights?: any[]
    selectedHotels?: any[]
    weatherData?: any
    localEvents?: any[]
  }
}

export interface GeneratedItinerary {
  overview: {
    title: string
    description: string
    highlights: string[]
    themes: string[]
  }
  totalBudget: {
    estimated: number
    currency: string
    breakdown: {
      accommodation: number
      activities: number
      food: number
      transportation: number
    }
    confidence: number
  }
  dailyItinerary: DailyItinerary[]
  travelTips: {
    general: string[]
    cultural: string[]
    practical: string[]
    safety: string[]
  }
  emergencyInfo: {
    emergency: string
    police: string
    medical: string
    embassy: Record<string, string>
    hospitals: Array<{
      name: string
      phone: string
      address: string
    }>
  }
  recommendations: {
    restaurants: Array<{
      name: string
      cuisine: string
      priceRange: string
      location: string
      specialties: string[]
      reservationRequired: boolean
    }>
    activities: Array<{
      name: string
      type: string
      duration: number
      cost: number
      difficulty: string
      bestTime: string
      bookingRequired: boolean
    }>
    shopping: Array<{
      name: string
      type: string
      location: string
      specialties: string[]
      priceRange: string
    }>
  }
  localInsights: {
    culture: string[]
    etiquette: string[]
    language: {
      basicPhrases: Record<string, string>
      usefulWords: Record<string, string>
    }
    transportation: {
      publicTransport: string
      taxiApps: string[]
      walkingAreas: string[]
    }
    weather: {
      general: string
      clothing: string[]
      seasonalTips: string[]
    }
  }
  generationMetadata: {
    model: string
    confidence: number
    tokensUsed: number
    generatedAt: string
    version: string
  }
}

export interface DailyItinerary {
  day: number
  date: string
  theme: string
  location: string
  activities: ItineraryActivity[]
  meals: ItineraryMeal[]
  transportation: TransportationPlan[]
  dailyBudget: {
    estimated: number
    breakdown: {
      activities: number
      food: number
      transportation: number
      miscellaneous: number
    }
  }
  tips: string[]
  alternatives: Array<{
    type: 'activity' | 'restaurant' | 'route'
    original: string
    alternative: string
    reason: string
  }>
}

export interface ItineraryActivity {
  time: string
  duration: number
  type: 'sightseeing' | 'museum' | 'outdoor' | 'cultural' | 'entertainment' | 'shopping' | 'relaxation'
  title: string
  description: string
  location: {
    name: string
    address: string
    coordinates?: {
      latitude: number
      longitude: number
    }
  }
  cost: {
    amount: number
    currency: string
    priceType: 'fixed' | 'estimated' | 'free' | 'variable'
  }
  bookingInfo: {
    required: boolean
    website?: string
    phone?: string
    advanceNotice?: string
  }
  accessibility: {
    wheelchairAccessible: boolean
    mobilityFriendly: boolean
    notes?: string
  }
  tips: string[]
  alternatives: string[]
}

export interface ItineraryMeal {
  time: string
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  restaurant: {
    name: string
    cuisine: string
    location: string
    priceRange: string
    atmosphere: string
  }
  estimatedCost: {
    amount: number
    currency: string
  }
  reservationInfo: {
    required: boolean
    phone?: string
    website?: string
  }
  highlights: string[]
  dietaryOptions: string[]
}

export interface TransportationPlan {
  from: string
  to: string
  method: 'walking' | 'taxi' | 'public' | 'rental-car' | 'rideshare'
  duration: number
  cost: {
    amount: number
    currency: string
  }
  instructions: string
  alternatives: string[]
}

export class ClaudeService {
  private client: Anthropic
  private redis: RedisService

  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    })
    
    this.redis = new RedisService()
  }

  async generateItinerary(params: ItineraryGenerationParams): Promise<GeneratedItinerary> {
    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(params)
      
      // Check cache first (itineraries can be cached for a short time)
      const cachedResult = await this.redis.get(cacheKey)
      if (cachedResult) {
        logger.info('Itinerary retrieved from cache', { cacheKey })
        return JSON.parse(cachedResult)
      }

      // Build the prompt
      const prompt = this.buildItineraryPrompt(params)
      
      logger.info('Generating itinerary with Claude AI', {
        destination: params.destination,
        duration: params.duration,
        travelers: params.travelers,
        budget: params.budget.total,
      })

      // Make API request to Claude
      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        temperature: config.anthropic.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      // Parse the response
      const content = response.content[0]
      if (content.type !== 'text') {
        throw new Error('Unexpected response format from Claude API')
      }

      const itinerary = this.parseItineraryResponse(content.text, params)
      
      // Add generation metadata
      itinerary.generationMetadata = {
        model: config.anthropic.model,
        confidence: this.calculateConfidence(params, itinerary),
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
        generatedAt: new Date().toISOString(),
        version: '1.0',
      }

      // Cache the result for 1 hour
      await this.redis.setex(cacheKey, 3600, JSON.stringify(itinerary))
      
      logger.info('Itinerary generated successfully', {
        destination: params.destination,
        activitiesCount: itinerary.dailyItinerary.reduce((acc, day) => acc + day.activities.length, 0),
        estimatedBudget: itinerary.totalBudget.estimated,
        tokensUsed: itinerary.generationMetadata.tokensUsed,
      })

      return itinerary
    } catch (error: any) {
      logger.error('Itinerary generation failed:', {
        error: error.message,
        stack: error.stack,
        params: {
          destination: params.destination,
          duration: params.duration,
        },
      })

      if (error.status === 429) {
        throw new Error('AI service rate limit exceeded. Please try again in a moment.')
      } else if (error.status === 400) {
        throw new Error('Invalid request parameters for itinerary generation.')
      }

      throw new Error('Itinerary generation service temporarily unavailable.')
    }
  }

  async refineItinerary(
    originalItinerary: GeneratedItinerary,
    refinementRequest: {
      type: 'modify_activity' | 'change_budget' | 'adjust_pace' | 'add_preferences'
      details: any
      userFeedback?: string
    }
  ): Promise<GeneratedItinerary> {
    try {
      const prompt = this.buildRefinementPrompt(originalItinerary, refinementRequest)
      
      logger.info('Refining itinerary with Claude AI', {
        refinementType: refinementRequest.type,
      })

      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: config.anthropic.maxTokens,
        temperature: 0.5, // Lower temperature for refinements
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      const content = response.content[0]
      if (content.type !== 'text') {
        throw new Error('Unexpected response format from Claude API')
      }

      const refinedItinerary = this.parseItineraryResponse(content.text, {
        destination: originalItinerary.dailyItinerary[0]?.location || '',
        duration: originalItinerary.dailyItinerary.length,
        startDate: originalItinerary.dailyItinerary[0]?.date || '',
        endDate: originalItinerary.dailyItinerary[originalItinerary.dailyItinerary.length - 1]?.date || '',
        travelers: { adults: 2, children: 0 }, // Default values
        budget: originalItinerary.totalBudget,
        preferences: { interests: [], pace: 'moderate', accommodationType: '', diningPreferences: [], activityTypes: [], accessibility: { wheelchair: false, mobility: 'full' } },
        constraints: { avoidAreas: [], mustVisit: [], budgetConstraints: { maxMealCost: 0, maxActivityCost: 0 } },
      })

      // Update generation metadata
      refinedItinerary.generationMetadata = {
        ...originalItinerary.generationMetadata,
        tokensUsed: originalItinerary.generationMetadata.tokensUsed + response.usage.input_tokens + response.usage.output_tokens,
        generatedAt: new Date().toISOString(),
      }

      logger.info('Itinerary refined successfully', {
        refinementType: refinementRequest.type,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      })

      return refinedItinerary
    } catch (error: any) {
      logger.error('Itinerary refinement failed:', error)
      throw new Error('Unable to refine itinerary. Please try again.')
    }
  }

  async generateActivitySuggestions(
    destination: string,
    interests: string[],
    budget: number,
    duration: number
  ): Promise<ItineraryActivity[]> {
    try {
      const prompt = this.buildActivitySuggestionsPrompt(destination, interests, budget, duration)
      
      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 2000,
        temperature: 0.8,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      const content = response.content[0]
      if (content.type !== 'text') {
        throw new Error('Unexpected response format from Claude API')
      }

      return this.parseActivitySuggestions(content.text)
    } catch (error: any) {
      logger.error('Activity suggestions generation failed:', error)
      throw new Error('Unable to generate activity suggestions.')
    }
  }

  private buildItineraryPrompt(params: ItineraryGenerationParams): string {
    const {
      destination,
      duration,
      startDate,
      endDate,
      travelers,
      budget,
      preferences,
      constraints,
      context,
    } = params

    return `You are a professional travel planner with extensive knowledge of destinations worldwide. Create a detailed ${duration}-day travel itinerary for ${destination}.

TRIP DETAILS:
- Destination: ${destination}
- Duration: ${duration} days (${startDate} to ${endDate})
- Travelers: ${travelers.adults} adults${travelers.children > 0 ? `, ${travelers.children} children` : ''}
- Total Budget: ${budget.total} ${budget.currency}
- Budget Breakdown:
  * Accommodation: ${budget.categories.accommodation} ${budget.currency}
  * Activities: ${budget.categories.activities} ${budget.currency}
  * Food: ${budget.categories.food} ${budget.currency}
  * Transportation: ${budget.categories.transportation} ${budget.currency}

PREFERENCES:
- Interests: ${preferences.interests.join(', ')}
- Travel Pace: ${preferences.pace}
- Accommodation Type: ${preferences.accommodationType}
- Dining Preferences: ${preferences.diningPreferences.join(', ')}
- Activity Types: ${preferences.activityTypes.join(', ')}
- Accessibility Needs: ${preferences.accessibility.wheelchair ? 'Wheelchair accessible' : 'Standard mobility'}${preferences.accessibility.mobility !== 'full' ? `, Limited mobility considerations` : ''}

CONSTRAINTS:
${constraints.mustVisit.length > 0 ? `- Must Visit: ${constraints.mustVisit.join(', ')}` : ''}
${constraints.avoidAreas.length > 0 ? `- Avoid Areas: ${constraints.avoidAreas.join(', ')}` : ''}
- Maximum meal cost: ${constraints.budgetConstraints.maxMealCost} ${budget.currency}
- Maximum activity cost: ${constraints.budgetConstraints.maxActivityCost} ${budget.currency}

${context?.selectedFlights ? `SELECTED FLIGHTS:\n${JSON.stringify(context.selectedFlights, null, 2)}\n` : ''}
${context?.selectedHotels ? `SELECTED HOTELS:\n${JSON.stringify(context.selectedHotels, null, 2)}\n` : ''}

Please provide a comprehensive itinerary in the following JSON format:

{
  "overview": {
    "title": "Engaging title for the trip",
    "description": "Brief overview of the trip experience",
    "highlights": ["Top 5-7 trip highlights"],
    "themes": ["Main themes of the trip"]
  },
  "totalBudget": {
    "estimated": estimated_total_cost,
    "currency": "${budget.currency}",
    "breakdown": {
      "accommodation": estimated_accommodation_cost,
      "activities": estimated_activities_cost,
      "food": estimated_food_cost,
      "transportation": estimated_transportation_cost
    },
    "confidence": confidence_score_0_to_1
  },
  "dailyItinerary": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "theme": "Day theme",
      "location": "Primary location for the day",
      "activities": [
        {
          "time": "HH:MM",
          "duration": duration_in_minutes,
          "type": "activity_type",
          "title": "Activity title",
          "description": "Detailed description",
          "location": {
            "name": "Location name",
            "address": "Full address"
          },
          "cost": {
            "amount": cost_amount,
            "currency": "${budget.currency}",
            "priceType": "fixed|estimated|free|variable"
          },
          "bookingInfo": {
            "required": true|false,
            "website": "booking_website",
            "phone": "phone_number",
            "advanceNotice": "how_far_in_advance"
          },
          "accessibility": {
            "wheelchairAccessible": true|false,
            "mobilityFriendly": true|false,
            "notes": "accessibility_notes"
          },
          "tips": ["Practical tips for this activity"],
          "alternatives": ["Alternative options if this isn't available"]
        }
      ],
      "meals": [
        {
          "time": "HH:MM",
          "type": "breakfast|lunch|dinner|snack",
          "restaurant": {
            "name": "Restaurant name",
            "cuisine": "Cuisine type",
            "location": "Location description",
            "priceRange": "$|$$|$$$|$$$$",
            "atmosphere": "Atmosphere description"
          },
          "estimatedCost": {
            "amount": cost_per_person,
            "currency": "${budget.currency}"
          },
          "reservationInfo": {
            "required": true|false,
            "phone": "phone_number",
            "website": "reservation_website"
          },
          "highlights": ["Signature dishes or specialties"],
          "dietaryOptions": ["Available dietary accommodations"]
        }
      ],
      "transportation": [
        {
          "from": "Starting point",
          "to": "Destination",
          "method": "transportation_method",
          "duration": duration_in_minutes,
          "cost": {
            "amount": cost_amount,
            "currency": "${budget.currency}"
          },
          "instructions": "Detailed instructions",
          "alternatives": ["Alternative transportation options"]
        }
      ],
      "dailyBudget": {
        "estimated": daily_total,
        "breakdown": {
          "activities": activities_cost,
          "food": food_cost,
          "transportation": transport_cost,
          "miscellaneous": misc_cost
        }
      },
      "tips": ["Daily tips and advice"],
      "alternatives": [
        {
          "type": "activity|restaurant|route",
          "original": "Original item",
          "alternative": "Alternative option",
          "reason": "Why this alternative is good"
        }
      ]
    }
  ],
  "travelTips": {
    "general": ["General travel tips for the destination"],
    "cultural": ["Cultural insights and etiquette"],
    "practical": ["Practical tips for getting around"],
    "safety": ["Safety considerations and tips"]
  },
  "emergencyInfo": {
    "emergency": "emergency_number",
    "police": "police_number",
    "medical": "medical_emergency_number",
    "embassy": {
      "us": "us_embassy_number",
      "uk": "uk_embassy_number"
    },
    "hospitals": [
      {
        "name": "Hospital name",
        "phone": "phone_number",
        "address": "Full address"
      }
    ]
  },
  "recommendations": {
    "restaurants": [
      {
        "name": "Restaurant name",
        "cuisine": "Cuisine type",
        "priceRange": "$|$$|$$$|$$$$",
        "location": "Location description",
        "specialties": ["Signature dishes"],
        "reservationRequired": true|false
      }
    ],
    "activities": [
      {
        "name": "Activity name",
        "type": "Activity type",
        "duration": duration_in_minutes,
        "cost": estimated_cost,
        "difficulty": "easy|moderate|challenging",
        "bestTime": "Best time to visit",
        "bookingRequired": true|false
      }
    ],
    "shopping": [
      {
        "name": "Shopping area/store name",
        "type": "Type of shopping",
        "location": "Location description",
        "specialties": ["What to buy here"],
        "priceRange": "Price range indication"
      }
    ]
  },
  "localInsights": {
    "culture": ["Cultural insights and customs"],
    "etiquette": ["Local etiquette and manners"],
    "language": {
      "basicPhrases": {
        "hello": "local_greeting",
        "thank_you": "local_thank_you",
        "please": "local_please",
        "excuse_me": "local_excuse_me"
      },
      "usefulWords": {
        "bathroom": "local_word",
        "water": "local_word",
        "help": "local_word"
      }
    },
    "transportation": {
      "publicTransport": "How public transport works",
      "taxiApps": ["Popular taxi/rideshare apps"],
      "walkingAreas": ["Best areas for walking"]
    },
    "weather": {
      "general": "General weather information",
      "clothing": ["Recommended clothing items"],
      "seasonalTips": ["Season-specific advice"]
    }
  }
}

Important guidelines:
1. Ensure all costs stay within the specified budget
2. Consider the travel pace preference when scheduling activities
3. Include realistic travel times between locations
4. Provide specific, actionable information
5. Consider accessibility requirements
6. Include backup plans and alternatives
7. Make recommendations culturally appropriate and respectful
8. Ensure all activities are suitable for the traveler composition
9. Provide accurate contact information where possible
10. Consider local customs, holidays, and seasonal variations`
  }

  private buildRefinementPrompt(
    originalItinerary: GeneratedItinerary,
    refinementRequest: any
  ): string {
    return `You are a professional travel planner refining an existing itinerary based on user feedback.

ORIGINAL ITINERARY:
${JSON.stringify(originalItinerary, null, 2)}

REFINEMENT REQUEST:
Type: ${refinementRequest.type}
Details: ${JSON.stringify(refinementRequest.details, null, 2)}
${refinementRequest.userFeedback ? `User Feedback: ${refinementRequest.userFeedback}` : ''}

Please provide a refined version of the itinerary that addresses the user's request while maintaining the overall quality and structure. Keep the same JSON format as the original itinerary.

Guidelines:
1. Only modify elements related to the refinement request
2. Maintain budget constraints
3. Ensure logical flow between activities
4. Keep alternative options where appropriate
5. Update costs and timing if activities change
6. Maintain the same level of detail as the original`
  }

  private buildActivitySuggestionsPrompt(
    destination: string,
    interests: string[],
    budget: number,
    duration: number
  ): string {
    return `Suggest ${duration * 3} diverse activities for ${destination} based on these interests: ${interests.join(', ')}.
Budget consideration: ${budget} total for activities.

Provide activities in this JSON format:
[
  {
    "time": "suggested_time",
    "duration": duration_in_minutes,
    "type": "activity_type",
    "title": "Activity title",
    "description": "Description",
    "location": {
      "name": "Location name",
      "address": "Address"
    },
    "cost": {
      "amount": cost,
      "currency": "USD",
      "priceType": "estimated"
    },
    "bookingInfo": {
      "required": true|false
    },
    "accessibility": {
      "wheelchairAccessible": true|false,
      "mobilityFriendly": true|false
    },
    "tips": ["Tips"],
    "alternatives": ["Alternatives"]
  }
]`
  }

  private parseItineraryResponse(response: string, params: ItineraryGenerationParams): GeneratedItinerary {
    try {
      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response')
      }

      const itinerary = JSON.parse(jsonMatch[0])
      
      // Validate required fields
      if (!itinerary.overview || !itinerary.dailyItinerary) {
        throw new Error('Invalid itinerary structure')
      }

      return itinerary as GeneratedItinerary
    } catch (error: any) {
      logger.error('Failed to parse itinerary response:', {
        error: error.message,
        response: response.substring(0, 500),
      })
      
      // Return a fallback itinerary
      return this.generateFallbackItinerary(params)
    }
  }

  private parseActivitySuggestions(response: string): ItineraryActivity[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        return []
      }

      return JSON.parse(jsonMatch[0])
    } catch (error) {
      logger.error('Failed to parse activity suggestions:', error)
      return []
    }
  }

  private generateFallbackItinerary(params: ItineraryGenerationParams): GeneratedItinerary {
    // Generate a basic fallback itinerary when AI parsing fails
    return {
      overview: {
        title: `${params.duration}-Day ${params.destination} Adventure`,
        description: `Explore the best of ${params.destination} over ${params.duration} days.`,
        highlights: [`Visit ${params.destination}`, 'Explore local culture', 'Enjoy local cuisine'],
        themes: ['Cultural exploration', 'Local experiences'],
      },
      totalBudget: {
        estimated: params.budget.total,
        currency: params.budget.currency,
        breakdown: params.budget.categories,
        confidence: 0.5,
      },
      dailyItinerary: Array.from({ length: params.duration }, (_, index) => ({
        day: index + 1,
        date: new Date(new Date(params.startDate).getTime() + index * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        theme: `Day ${index + 1} in ${params.destination}`,
        location: params.destination,
        activities: [],
        meals: [],
        transportation: [],
        dailyBudget: {
          estimated: params.budget.total / params.duration,
          breakdown: {
            activities: params.budget.categories.activities / params.duration,
            food: params.budget.categories.food / params.duration,
            transportation: params.budget.categories.transportation / params.duration,
            miscellaneous: 0,
          },
        },
        tips: [],
        alternatives: [],
      })),
      travelTips: {
        general: [],
        cultural: [],
        practical: [],
        safety: [],
      },
      emergencyInfo: {
        emergency: '911',
        police: '911',
        medical: '911',
        embassy: {},
        hospitals: [],
      },
      recommendations: {
        restaurants: [],
        activities: [],
        shopping: [],
      },
      localInsights: {
        culture: [],
        etiquette: [],
        language: {
          basicPhrases: {},
          usefulWords: {},
        },
        transportation: {
          publicTransport: '',
          taxiApps: [],
          walkingAreas: [],
        },
        weather: {
          general: '',
          clothing: [],
          seasonalTips: [],
        },
      },
      generationMetadata: {
        model: 'fallback',
        confidence: 0.3,
        tokensUsed: 0,
        generatedAt: new Date().toISOString(),
        version: '1.0',
      },
    }
  }

  private calculateConfidence(params: ItineraryGenerationParams, itinerary: GeneratedItinerary): number {
    let confidence = 0.8 // Base confidence

    // Adjust based on completeness
    const hasActivities = itinerary.dailyItinerary.every(day => day.activities.length > 0)
    const hasMeals = itinerary.dailyItinerary.every(day => day.meals.length > 0)
    const hasTips = itinerary.travelTips.general.length > 0

    if (!hasActivities) confidence -= 0.2
    if (!hasMeals) confidence -= 0.1
    if (!hasTips) confidence -= 0.1

    // Adjust based on budget alignment
    const budgetDiff = Math.abs(itinerary.totalBudget.estimated - params.budget.total) / params.budget.total
    if (budgetDiff > 0.2) confidence -= 0.1

    return Math.max(0.1, Math.min(1.0, confidence))
  }

  private generateCacheKey(params: ItineraryGenerationParams): string {
    const key = `itinerary:${params.destination}:${params.duration}:${params.startDate}:${params.travelers.adults}:${params.travelers.children}:${params.budget.total}:${params.preferences.pace}:${params.preferences.interests.join(',')}`
    return key.toLowerCase().replace(/[^a-z0-9:,]/g, '_')
  }

  // Health check method
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
      })

      return response.content.length > 0
    } catch (error) {
      logger.error('Claude health check failed:', error)
      return false
    }
  }
}

export default ClaudeService