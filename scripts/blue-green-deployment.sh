#!/bin/bash

# Blue-Green Deployment Script for Travel Planner
# This script implements zero-downtime deployments using Cloud Run revisions

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${1:-travel-planner-api}"
IMAGE_URL="${2}"
ENVIRONMENT="${3:-production}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Validation function
validate_inputs() {
    if [[ -z "${PROJECT_ID}" ]]; then
        log_error "GCP_PROJECT_ID environment variable is required"
        exit 1
    fi
    
    if [[ -z "${IMAGE_URL}" ]]; then
        log_error "Image URL is required as second argument"
        exit 1
    fi
    
    log_info "Validating inputs..."
    log_info "Project ID: ${PROJECT_ID}"
    log_info "Region: ${REGION}"
    log_info "Service: ${SERVICE_NAME}"
    log_info "Image: ${IMAGE_URL}"
    log_info "Environment: ${ENVIRONMENT}"
}

# Health check function
health_check() {
    local url=$1
    local max_attempts=30
    local wait_seconds=10
    
    log_info "Performing health checks on ${url}"
    
    for ((i=1; i<=max_attempts; i++)); do
        if curl -sf "${url}/health" > /dev/null 2>&1; then
            log_success "Health check passed (attempt ${i}/${max_attempts})"
            return 0
        else
            if [[ $i -eq $max_attempts ]]; then
                log_error "Health check failed after ${max_attempts} attempts"
                return 1
            else
                log_warning "Health check failed (attempt ${i}/${max_attempts}), retrying in ${wait_seconds}s..."
                sleep $wait_seconds
            fi
        fi
    done
}

# Enhanced health check with detailed validation
comprehensive_health_check() {
    local url=$1
    local revision_name=$2
    
    log_info "Running comprehensive health checks for revision ${revision_name}"
    
    # Basic health check
    if ! health_check "${url}"; then
        return 1
    fi
    
    # Check readiness endpoint
    log_info "Checking readiness endpoint..."
    if ! curl -sf "${url}/ready" > /dev/null 2>&1; then
        log_error "Readiness check failed"
        return 1
    fi
    
    # Check API endpoints
    log_info "Testing critical API endpoints..."
    
    # Test health endpoint with detailed response
    health_response=$(curl -s "${url}/health" | jq -r '.status // "unknown"')
    if [[ "${health_response}" != "healthy" ]]; then
        log_error "Health endpoint returned status: ${health_response}"
        return 1
    fi
    
    # Test API version endpoint
    if ! curl -sf "${url}/api/v1" > /dev/null 2>&1; then
        log_warning "API version endpoint not responding correctly"
    fi
    
    log_success "Comprehensive health checks passed for revision ${revision_name}"
    return 0
}

# Get current revision
get_current_revision() {
    gcloud run services describe "${SERVICE_NAME}" \
        --region="${REGION}" \
        --format="value(status.traffic[0].revisionName)" 2>/dev/null || echo ""
}

# Get service URL
get_service_url() {
    gcloud run services describe "${SERVICE_NAME}" \
        --region="${REGION}" \
        --format="value(status.url)" 2>/dev/null || echo ""
}

# Deploy new revision without traffic
deploy_new_revision() {
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local revision_suffix="${ENVIRONMENT}-${timestamp}"
    
    log_info "Deploying new revision: ${SERVICE_NAME}-${revision_suffix}"
    
    # Get current service configuration for consistency
    local current_env_vars
    current_env_vars=$(gcloud run services describe "${SERVICE_NAME}" \
        --region="${REGION}" \
        --format="value(spec.template.spec.template.spec.containers[0].env[].name,spec.template.spec.template.spec.containers[0].env[].value)" 2>/dev/null || true)
    
    # Deploy new revision without traffic
    gcloud run deploy "${SERVICE_NAME}" \
        --image="${IMAGE_URL}" \
        --platform=managed \
        --region="${REGION}" \
        --service-account="travel-planner-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
        --port=8080 \
        --memory=2Gi \
        --cpu=2 \
        --min-instances=1 \
        --max-instances=10 \
        --concurrency=80 \
        --timeout=300 \
        --set-env-vars="NODE_ENV=${ENVIRONMENT},PORT=8080,DEPLOYMENT_TIMESTAMP=${timestamp}" \
        --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest,AMADEUS_CLIENT_ID=amadeus-client-id:latest,AMADEUS_CLIENT_SECRET=amadeus-client-secret:latest,JWT_SECRET=jwt-secret:latest" \
        --labels="app=travel-planner,component=backend,environment=${ENVIRONMENT},deployment-strategy=blue-green" \
        --revision-suffix="${revision_suffix}" \
        --no-traffic \
        --quiet
    
    echo "${SERVICE_NAME}-${revision_suffix}"
}

# Gradual traffic shifting
shift_traffic_gradually() {
    local new_revision=$1
    local service_url=$2
    
    log_info "Starting gradual traffic shift to revision: ${new_revision}"
    
    # Phase 1: 10% traffic
    log_info "Phase 1: Shifting 10% traffic to new revision"
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --to-revisions="${new_revision}=10,LATEST=90" \
        --region="${REGION}" \
        --quiet
    
    # Monitor for issues during 10% traffic
    log_info "Monitoring for 5 minutes at 10% traffic..."
    sleep 300
    
    if ! monitor_revision_health "${new_revision}" "${service_url}"; then
        log_error "Issues detected at 10% traffic, rolling back"
        return 1
    fi
    
    # Phase 2: 50% traffic
    log_info "Phase 2: Shifting 50% traffic to new revision"
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --to-revisions="${new_revision}=50,LATEST=50" \
        --region="${REGION}" \
        --quiet
    
    # Monitor for issues during 50% traffic
    log_info "Monitoring for 5 minutes at 50% traffic..."
    sleep 300
    
    if ! monitor_revision_health "${new_revision}" "${service_url}"; then
        log_error "Issues detected at 50% traffic, rolling back"
        return 1
    fi
    
    # Phase 3: 100% traffic
    log_info "Phase 3: Shifting 100% traffic to new revision"
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --to-revisions="${new_revision}=100" \
        --region="${REGION}" \
        --quiet
    
    # Final monitoring
    log_info "Monitoring for 10 minutes at 100% traffic..."
    sleep 600
    
    if ! monitor_revision_health "${new_revision}" "${service_url}"; then
        log_error "Issues detected at 100% traffic, rolling back"
        return 1
    fi
    
    log_success "Traffic shift completed successfully"
    return 0
}

# Monitor revision health during traffic shift
monitor_revision_health() {
    local revision_name=$1
    local service_url=$2
    
    log_info "Monitoring health of revision: ${revision_name}"
    
    # Check error rate using gcloud logging
    local error_count
    error_count=$(gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.revision_name=\"${revision_name}\" AND severity=\"ERROR\"" \
        --limit=50 \
        --format="value(timestamp)" \
        --freshness=5m | wc -l)
    
    if [[ $error_count -gt 5 ]]; then
        log_error "High error rate detected: ${error_count} errors in last 5 minutes"
        return 1
    fi
    
    # Perform health check
    if ! comprehensive_health_check "${service_url}" "${revision_name}"; then
        return 1
    fi
    
    log_success "Revision ${revision_name} is healthy"
    return 0
}

# Rollback to previous revision
rollback_deployment() {
    local current_revision
    current_revision=$(get_current_revision)
    
    if [[ -z "${current_revision}" ]]; then
        log_error "Cannot determine current revision for rollback"
        return 1
    fi
    
    log_warning "Rolling back to previous revision..."
    
    # Get previous revision (second in the list)
    local previous_revision
    previous_revision=$(gcloud run revisions list --service="${SERVICE_NAME}" \
        --region="${REGION}" \
        --limit=2 \
        --format="value(metadata.name)" | tail -n 1)
    
    if [[ -z "${previous_revision}" ]]; then
        log_error "Cannot find previous revision for rollback"
        return 1
    fi
    
    log_info "Rolling back to revision: ${previous_revision}"
    
    gcloud run services update-traffic "${SERVICE_NAME}" \
        --to-revisions="${previous_revision}=100" \
        --region="${REGION}" \
        --quiet
    
    # Verify rollback
    local service_url
    service_url=$(get_service_url)
    
    if comprehensive_health_check "${service_url}" "${previous_revision}"; then
        log_success "Rollback completed successfully"
        return 0
    else
        log_error "Rollback failed - service still unhealthy"
        return 1
    fi
}

# Cleanup old revisions
cleanup_old_revisions() {
    log_info "Cleaning up old revisions (keeping last 5)"
    
    # Get revisions older than the 5 most recent
    local old_revisions
    old_revisions=$(gcloud run revisions list --service="${SERVICE_NAME}" \
        --region="${REGION}" \
        --format="value(metadata.name)" | tail -n +6)
    
    if [[ -n "${old_revisions}" ]]; then
        echo "${old_revisions}" | while read -r revision; do
            if [[ -n "${revision}" ]]; then
                log_info "Deleting old revision: ${revision}"
                gcloud run revisions delete "${revision}" \
                    --region="${REGION}" \
                    --quiet || log_warning "Failed to delete revision: ${revision}"
            fi
        done
    else
        log_info "No old revisions to clean up"
    fi
}

# Main deployment function
main() {
    log_info "Starting blue-green deployment for ${SERVICE_NAME}"
    
    validate_inputs
    
    # Get current state
    local current_revision
    current_revision=$(get_current_revision)
    local service_url
    service_url=$(get_service_url)
    
    log_info "Current revision: ${current_revision:-none}"
    log_info "Service URL: ${service_url}"
    
    # Deploy new revision
    local new_revision
    if ! new_revision=$(deploy_new_revision); then
        log_error "Failed to deploy new revision"
        exit 1
    fi
    
    log_success "New revision deployed: ${new_revision}"
    
    # Wait for revision to be ready
    log_info "Waiting for new revision to be ready..."
    sleep 30
    
    # Get the URL for the new revision (with tag)
    local new_revision_url="${service_url%/*}/${new_revision}/${service_url##*/}"
    
    # Perform comprehensive health check on new revision
    if ! comprehensive_health_check "${service_url}" "${new_revision}"; then
        log_error "New revision failed health checks"
        log_info "Cleaning up failed revision..."
        gcloud run revisions delete "${new_revision}" --region="${REGION}" --quiet || true
        exit 1
    fi
    
    # Gradual traffic shift
    if ! shift_traffic_gradually "${new_revision}" "${service_url}"; then
        log_error "Traffic shift failed, attempting rollback..."
        if rollback_deployment; then
            log_success "Rollback completed"
        else
            log_error "Rollback also failed - manual intervention required"
        fi
        exit 1
    fi
    
    # Cleanup old revisions
    cleanup_old_revisions
    
    log_success "Blue-green deployment completed successfully!"
    log_info "New revision: ${new_revision}"
    log_info "Service URL: ${service_url}"
    
    # Send notification
    if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"🚀 Blue-green deployment successful!\n*Service:* ${SERVICE_NAME}\n*Revision:* ${new_revision}\n*Environment:* ${ENVIRONMENT}\n*URL:* ${service_url}\"}" \
            "${SLACK_WEBHOOK_URL}" || log_warning "Failed to send Slack notification"
    fi
}

# Trap for cleanup on exit
cleanup_on_exit() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "Deployment failed with exit code: ${exit_code}"
        
        # Send failure notification
        if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
            curl -X POST -H 'Content-type: application/json' \
                --data "{\"text\":\"❌ Blue-green deployment failed!\n*Service:* ${SERVICE_NAME}\n*Environment:* ${ENVIRONMENT}\n*Exit Code:* ${exit_code}\"}" \
                "${SLACK_WEBHOOK_URL}" || true
        fi
    fi
}

trap cleanup_on_exit EXIT

# Run main function
main "$@"