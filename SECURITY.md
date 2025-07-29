# Security Notice

## API Keys and Secrets

This application requires API keys to function properly. **NEVER commit API keys to version control**.

### Required Environment Variables

- `ANTHROPIC_API_KEY` - Your Anthropic Claude API key
- `AMADEUS_API_KEY` - Your Amadeus travel API key  
- `AMADEUS_API_SECRET` - Your Amadeus API secret

### Setting Up Environment Variables

1. Copy `.env.example` to `.env`
2. Replace placeholder values with your actual API keys
3. Never commit the `.env` file

### For Deployment

When deploying to GCP or other cloud providers:
1. Use secret management services
2. Set environment variables in your deployment configuration
3. Update `deploy.sh` to use environment variables from your local environment

### Security Best Practices

1. Rotate API keys regularly
2. Use least-privilege access controls
3. Monitor API usage for anomalies
4. Use environment-specific keys (dev/staging/prod)
5. Enable API key restrictions when possible