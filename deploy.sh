#!/bin/bash

# Quick deployment script with updated credentials
gcloud run deploy ai-travel-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10 \
  --set-env-vars="GCP_PROJECT_ID=anuraaggupta2601,ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY,AMADEUS_API_KEY=$AMADEUS_API_KEY,AMADEUS_API_SECRET=$AMADEUS_API_SECRET" \
  --quiet