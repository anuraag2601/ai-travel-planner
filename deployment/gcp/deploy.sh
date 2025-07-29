#!/bin/bash

# Travel Itinerary Planner - Google Cloud Platform Deployment Script
# This script deploys the application to Google Cloud Platform using Cloud Run

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=${GCP_PROJECT_ID:-""}
REGION=${GCP_REGION:-"us-central1"}
SERVICE_NAME_BACKEND="travel-planner-api"
SERVICE_NAME_FRONTEND="travel-planner-web"

# Container Registry URLs
BACKEND_IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME_BACKEND}"
FRONTEND_IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME_FRONTEND}"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if required tools are installed
check_requirements() {
    print_status "Checking requirements..."
    
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed. Please install it first."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install it first."
        exit 1
    fi
    
    print_success "All requirements are met."
}

# Function to validate environment variables
validate_env() {
    print_status "Validating environment variables..."
    
    if [ -z "$PROJECT_ID" ]; then
        print_error "GCP_PROJECT_ID is not set. Please set it in your environment or .env file."
        exit 1
    fi
    
    # Check for required API keys
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        print_error "ANTHROPIC_API_KEY is not set."
        exit 1
    fi
    
    if [ -z "$AMADEUS_CLIENT_ID" ] || [ -z "$AMADEUS_CLIENT_SECRET" ]; then
        print_error "Amadeus API credentials are not set."
        exit 1
    fi
    
    if [ -z "$VITE_FIREBASE_API_KEY" ] || [ -z "$VITE_FIREBASE_PROJECT_ID" ]; then
        print_error "Firebase configuration is not set."
        exit 1
    fi
    
    print_success "Environment variables validated."
}

# Function to authenticate with Google Cloud
authenticate_gcp() {
    print_status "Authenticating with Google Cloud..."
    
    # Check if already authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
        print_status "Please authenticate with Google Cloud..."
        gcloud auth login
    fi
    
    # Set the project
    gcloud config set project $PROJECT_ID
    
    print_success "Authenticated with Google Cloud."
}

# Function to enable required APIs
enable_apis() {
    print_status "Enabling required Google Cloud APIs..."
    
    gcloud services enable \
        cloudbuild.googleapis.com \
        run.googleapis.com \
        containerregistry.googleapis.com \
        firestore.googleapis.com \
        secretmanager.googleapis.com \
        monitoring.googleapis.com \
        logging.googleapis.com
    
    print_success "APIs enabled."
}

# Function to create secrets in Secret Manager
create_secrets() {
    print_status "Creating secrets in Secret Manager..."
    
    # Create secrets from environment variables
    secrets=(
        "anthropic-api-key:$ANTHROPIC_API_KEY"
        "amadeus-client-id:$AMADEUS_CLIENT_ID"
        "amadeus-client-secret:$AMADEUS_CLIENT_SECRET"
        "jwt-secret:$JWT_SECRET"
        "sendgrid-api-key:$SENDGRID_API_KEY"
    )
    
    for secret in "${secrets[@]}"; do
        IFS=: read -r secret_name secret_value <<< "$secret"
        
        if [ -n "$secret_value" ]; then
            # Check if secret already exists
            if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &> /dev/null; then
                print_warning "Secret $secret_name already exists, updating..."
                echo -n "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=-
            else
                print_status "Creating secret $secret_name..."
                echo -n "$secret_value" | gcloud secrets create "$secret_name" --data-file=-
            fi
        fi
    done
    
    # Upload Firebase service account key if exists
    if [ -f "../../secrets/firebase-service-account.json" ]; then
        if gcloud secrets describe "firebase-service-account" --project="$PROJECT_ID" &> /dev/null; then
            print_warning "Firebase service account secret already exists, updating..."
            gcloud secrets versions add "firebase-service-account" --data-file="../../secrets/firebase-service-account.json"
        else
            print_status "Creating Firebase service account secret..."
            gcloud secrets create "firebase-service-account" --data-file="../../secrets/firebase-service-account.json"
        fi
    fi
    
    print_success "Secrets created/updated."
}

# Function to build and push Docker images
build_and_push_images() {
    print_status "Building and pushing Docker images..."
    
    # Configure Docker to use gcloud as a credential helper
    gcloud auth configure-docker
    
    # Build and push backend image
    print_status "Building backend image..."
    docker build -t "$BACKEND_IMAGE:latest" -f ../../backend/Dockerfile ../../backend/
    docker push "$BACKEND_IMAGE:latest"
    
    # Build and push frontend image
    print_status "Building frontend image..."
    docker build -t "$FRONTEND_IMAGE:latest" \
        --build-arg VITE_API_BASE_URL="https://${SERVICE_NAME_BACKEND}-${PROJECT_ID}.a.run.app/api/v1" \
        --build-arg VITE_FIREBASE_API_KEY="$VITE_FIREBASE_API_KEY" \
        --build-arg VITE_FIREBASE_AUTH_DOMAIN="$VITE_FIREBASE_AUTH_DOMAIN" \
        --build-arg VITE_FIREBASE_PROJECT_ID="$VITE_FIREBASE_PROJECT_ID" \
        --build-arg VITE_GOOGLE_MAPS_API_KEY="$VITE_GOOGLE_MAPS_API_KEY" \
        -f ../../frontend/Dockerfile ../../frontend/
    docker push "$FRONTEND_IMAGE:latest"
    
    print_success "Images built and pushed."
}

# Function to deploy backend to Cloud Run
deploy_backend() {
    print_status "Deploying backend to Cloud Run..."
    
    gcloud run deploy "$SERVICE_NAME_BACKEND" \
        --image="$BACKEND_IMAGE:latest" \
        --platform=managed \
        --region="$REGION" \
        --allow-unauthenticated \
        --port=8080 \
        --memory=2Gi \
        --cpu=2 \
        --min-instances=0 \
        --max-instances=10 \
        --concurrency=80 \
        --timeout=300 \
        --set-env-vars="NODE_ENV=production,PORT=8080" \
        --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest,AMADEUS_CLIENT_ID=amadeus-client-id:latest,AMADEUS_CLIENT_SECRET=amadeus-client-secret:latest,JWT_SECRET=jwt-secret:latest,SENDGRID_API_KEY=sendgrid-api-key:latest,FIRESTORE_CREDENTIALS=firebase-service-account:latest" \
        --service-account="travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
        --labels="app=travel-planner,component=backend"
    
    print_success "Backend deployed to Cloud Run."
}

# Function to deploy frontend to Cloud Run
deploy_frontend() {
    print_status "Deploying frontend to Cloud Run..."
    
    # Get backend service URL
    BACKEND_URL=$(gcloud run services describe "$SERVICE_NAME_BACKEND" --region="$REGION" --format="value(status.url)")
    
    gcloud run deploy "$SERVICE_NAME_FRONTEND" \
        --image="$FRONTEND_IMAGE:latest" \
        --platform=managed \
        --region="$REGION" \
        --allow-unauthenticated \
        --port=80 \
        --memory=512Mi \
        --cpu=1 \
        --min-instances=0 \
        --max-instances=5 \
        --concurrency=100 \
        --timeout=60 \
        --set-env-vars="VITE_API_BASE_URL=${BACKEND_URL}/api/v1" \
        --labels="app=travel-planner,component=frontend"
    
    print_success "Frontend deployed to Cloud Run."
}

# Function to set up Cloud Load Balancer (optional)
setup_load_balancer() {
    if [ "$SETUP_LOAD_BALANCER" = "true" ]; then
        print_status "Setting up Cloud Load Balancer..."
        
        # This is a simplified setup - in production, you'd want more detailed configuration
        gcloud compute url-maps create travel-planner-lb \
            --default-service=travel-planner-backend-neg
            
        gcloud compute target-http-proxies create travel-planner-proxy \
            --url-map=travel-planner-lb
            
        gcloud compute forwarding-rules create travel-planner-forwarding-rule \
            --global \
            --target-http-proxy=travel-planner-proxy \
            --ports=80
        
        print_success "Load balancer set up."
    fi
}

# Function to create service accounts and IAM bindings
setup_iam() {
    print_status "Setting up IAM..."
    
    # Create service account for backend
    if ! gcloud iam service-accounts describe "travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" &> /dev/null; then
        gcloud iam service-accounts create travel-planner-backend \
            --display-name="Travel Planner Backend Service Account"
    fi
    
    # Grant necessary permissions
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/datastore.user"
    
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor"
    
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/logging.logWriter"
    
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/monitoring.metricWriter"
    
    print_success "IAM configured."
}

# Function to display deployment information
show_deployment_info() {
    print_success "Deployment completed!"
    echo ""
    echo "🌟 Your Travel Itinerary Planner is now deployed!"
    echo ""
    echo "📱 Frontend URL:"
    gcloud run services describe "$SERVICE_NAME_FRONTEND" --region="$REGION" --format="value(status.url)"
    echo ""
    echo "🔧 Backend API URL:"
    gcloud run services describe "$SERVICE_NAME_BACKEND" --region="$REGION" --format="value(status.url)"
    echo ""
    echo "📊 Monitoring:"
    echo "  - Cloud Console: https://console.cloud.google.com/run?project=$PROJECT_ID"
    echo "  - Logs: https://console.cloud.google.com/logs/query?project=$PROJECT_ID"
    echo ""
    echo "🔐 Secrets:"
    echo "  - Secret Manager: https://console.cloud.google.com/security/secret-manager?project=$PROJECT_ID"
    echo ""
}

# Main deployment function
main() {
    print_status "Starting Travel Itinerary Planner deployment to Google Cloud Platform..."
    
    # Load environment variables if .env exists
    if [ -f "../../.env" ]; then
        print_status "Loading environment variables from .env file..."
        set -a  # automatically export all variables
        source "../../.env"
        set +a
    fi
    
    check_requirements
    validate_env
    authenticate_gcp
    enable_apis
    setup_iam
    create_secrets
    build_and_push_images
    deploy_backend
    deploy_frontend
    setup_load_balancer
    show_deployment_info
    
    print_success "🎉 Deployment completed successfully!"
}

# Handle script arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "cleanup")
        print_status "Cleaning up resources..."
        gcloud run services delete "$SERVICE_NAME_BACKEND" --region="$REGION" --quiet || true
        gcloud run services delete "$SERVICE_NAME_FRONTEND" --region="$REGION" --quiet || true
        print_success "Cleanup completed."
        ;;
    "logs")
        print_status "Showing logs..."
        gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME_BACKEND" --limit=50 --format="table(timestamp,severity,textPayload)"
        ;;
    *)
        echo "Usage: $0 {deploy|cleanup|logs}"
        exit 1
        ;;
esac