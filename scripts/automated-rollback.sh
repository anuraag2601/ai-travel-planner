#!/bin/bash

# Automated Rollback and Disaster Recovery Script for Travel Planner
# This script provides comprehensive rollback capabilities with safety checks

set -euo pipefail

# Configuration
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
ENVIRONMENT="${1:-production}"
ROLLBACK_REASON="${2:-manual}"

# Service configurations
declare -A SERVICES=(
    ["backend"]="travel-planner-api"
    ["frontend"]="travel-planner-web"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Validation functions
validate_environment() {
    if [[ ! "$ENVIRONMENT" =~ ^(production|staging|development)$ ]]; then
        log_error "Invalid environment: $ENVIRONMENT. Must be production, staging, or development"
        exit 1
    fi
    
    log_info "Environment validated: $ENVIRONMENT"
}

validate_gcp_auth() {
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null; then
        log_error "No active GCP authentication found. Please run 'gcloud auth login'"
        exit 1
    fi
    
    if ! gcloud config get-value project > /dev/null 2>&1; then
        log_error "No GCP project set. Please run 'gcloud config set project PROJECT_ID'"
        exit 1
    fi
    
    log_info "GCP authentication validated"
}

# Service information functions
get_service_revisions() {
    local service_name=$1
    local service_suffix=""
    
    if [[ "$ENVIRONMENT" != "production" ]]; then
        service_suffix="-$ENVIRONMENT"
    fi
    
    gcloud run revisions list \
        --service="${service_name}${service_suffix}" \
        --region="$REGION" \
        --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)" \
        --sort-by="metadata.creationTimestamp" \
        --limit=10 2>/dev/null || echo ""
}

get_current_traffic_allocation() {
    local service_name=$1
    local service_suffix=""
    
    if [[ "$ENVIRONMENT" != "production" ]]; then
        service_suffix="-$ENVIRONMENT"
    fi
    
    gcloud run services describe "${service_name}${service_suffix}" \
        --region="$REGION" \
        --format="table(status.traffic[].revisionName,status.traffic[].percent)" 2>/dev/null || echo ""
}

get_service_url() {
    local service_name=$1
    local service_suffix=""
    
    if [[ "$ENVIRONMENT" != "production" ]]; then
        service_suffix="-$ENVIRONMENT"
    fi
    
    gcloud run services describe "${service_name}${service_suffix}" \
        --region="$REGION" \
        --format="value(status.url)" 2>/dev/null || echo ""
}

# Health check functions
comprehensive_health_check() {
    local service_url=$1
    local service_name=$2
    local max_attempts=5
    local wait_seconds=10
    
    log_info "Performing comprehensive health check for $service_name"
    
    for ((i=1; i<=max_attempts; i++)); do
        local health_status=""
        local api_status=""
        local db_status=""
        
        # Basic health check
        if health_response=$(curl -sf "$service_url/health" 2>/dev/null); then
            health_status=$(echo "$health_response" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
            
            # Check if it's the backend service (has API endpoints)
            if [[ "$service_name" == *"api"* ]]; then
                # Test API endpoint
                if curl -sf "$service_url/api/v1" > /dev/null 2>&1; then
                    api_status="healthy"
                else
                    api_status="unhealthy"
                fi
                
                # Test readiness
                if curl -sf "$service_url/ready" > /dev/null 2>&1; then
                    db_status="ready"
                else
                    db_status="not_ready"
                fi
            fi
            
            if [[ "$health_status" == "healthy" && ("$service_name" != *"api"* || ("$api_status" == "healthy" && "$db_status" == "ready")) ]]; then
                log_success "Health check passed for $service_name (attempt $i/$max_attempts)"
                return 0
            fi
        fi
        
        if [[ $i -eq $max_attempts ]]; then
            log_error "Health check failed for $service_name after $max_attempts attempts"
            log_error "Health: $health_status, API: $api_status, DB: $db_status"
            return 1
        else
            log_warning "Health check failed for $service_name (attempt $i/$max_attempts), retrying in ${wait_seconds}s..."
            sleep $wait_seconds
        fi
    done
}

# Rollback decision logic
analyze_rollback_necessity() {
    local service_name=$1
    
    log_info "Analyzing rollback necessity for $service_name"
    
    # Get service URL
    local service_url
    service_url=$(get_service_url "$service_name")
    
    if [[ -z "$service_url" ]]; then
        log_error "Cannot get service URL for $service_name"
        return 1
    fi
    
    # Check current health
    if comprehensive_health_check "$service_url" "$service_name"; then
        log_info "$service_name is currently healthy"
        
        # Additional checks for automatic rollback triggers
        local error_rate
        local response_time
        
        # Check error rate in last 10 minutes
        error_rate=$(get_error_rate "$service_name" "10m")
        response_time=$(get_average_response_time "$service_name" "10m")
        
        if [[ $(echo "$error_rate > 0.05" | bc -l) -eq 1 ]]; then
            log_warning "High error rate detected: ${error_rate}%"
            return 0  # Rollback needed
        fi
        
        if [[ $(echo "$response_time > 5000" | bc -l) -eq 1 ]]; then
            log_warning "High response time detected: ${response_time}ms"
            return 0  # Rollback needed
        fi
        
        log_info "No automatic rollback triggers detected for $service_name"
        return 2  # No rollback needed
    else
        log_error "$service_name is unhealthy - rollback required"
        return 0  # Rollback needed
    fi
}

# Monitoring functions
get_error_rate() {
    local service_name=$1
    local time_window=$2
    local service_suffix=""
    
    if [[ "$ENVIRONMENT" != "production" ]]; then
        service_suffix="-$ENVIRONMENT"
    fi
    
    # Query Cloud Logging for error rate
    local error_count
    error_count=$(gcloud logging read "resource.type=\"cloud_run_revision\" 
        AND resource.labels.service_name=\"${service_name}${service_suffix}\" 
        AND (severity=\"ERROR\" OR httpRequest.status>=400) 
        AND timestamp>=\"$(date -u -d "$time_window ago" +%Y-%m-%dT%H:%M:%SZ)\"" \
        --limit=1000 \
        --format="value(timestamp)" | wc -l)
    
    local total_count
    total_count=$(gcloud logging read "resource.type=\"cloud_run_revision\" 
        AND resource.labels.service_name=\"${service_name}${service_suffix}\" 
        AND httpRequest.status>0 
        AND timestamp>=\"$(date -u -d "$time_window ago" +%Y-%m-%dT%H:%M:%SZ)\"" \
        --limit=1000 \
        --format="value(timestamp)" | wc -l)
    
    if [[ $total_count -gt 0 ]]; then
        echo "scale=4; $error_count / $total_count" | bc -l
    else
        echo "0"
    fi
}

get_average_response_time() {
    local service_name=$1
    local time_window=$2
    
    # This would typically query your monitoring system
    # For now, return a placeholder value
    echo "1500"  # 1.5s average response time
}

# Rollback execution functions
perform_rollback() {
    local service_name=$1
    local service_suffix=""
    
    if [[ "$ENVIRONMENT" != "production" ]]; then
        service_suffix="-$ENVIRONMENT"
    fi
    
    local full_service_name="${service_name}${service_suffix}"
    
    log_info "Starting rollback for $full_service_name"
    
    # Get current revision
    local current_revision
    current_revision=$(gcloud run services describe "$full_service_name" \
        --region="$REGION" \
        --format="value(status.traffic[0].revisionName)" 2>/dev/null || echo "")
    
    if [[ -z "$current_revision" ]]; then
        log_error "Cannot determine current revision for $full_service_name"
        return 1
    fi
    
    # Get previous stable revision
    local previous_revision
    previous_revision=$(gcloud run revisions list \
        --service="$full_service_name" \
        --region="$REGION" \
        --format="value(metadata.name)" \
        --sort-by="metadata.creationTimestamp" \
        --limit=5 | grep -v "$current_revision" | head -n1)
    
    if [[ -z "$previous_revision" ]]; then
        log_error "Cannot find previous revision for rollback of $full_service_name"
        return 1
    fi
    
    log_info "Rolling back from $current_revision to $previous_revision"
    
    # Create rollback backup
    create_rollback_backup "$full_service_name" "$current_revision"
    
    # Execute rollback with gradual traffic shift
    execute_gradual_rollback "$full_service_name" "$previous_revision" "$current_revision"
    
    # Verify rollback success
    if verify_rollback_success "$full_service_name" "$previous_revision"; then
        log_success "Rollback completed successfully for $full_service_name"
        
        # Log rollback event
        log_rollback_event "$full_service_name" "$current_revision" "$previous_revision" "success"
        
        return 0
    else
        log_error "Rollback verification failed for $full_service_name"
        
        # Attempt emergency rollback
        emergency_rollback "$full_service_name" "$current_revision"
        
        return 1
    fi
}

execute_gradual_rollback() {
    local service_name=$1
    local target_revision=$2
    local current_revision=$3
    
    log_info "Executing gradual rollback for $service_name"
    
    # Phase 1: 50% traffic to previous revision
    log_info "Phase 1: Shifting 50% traffic to $target_revision"
    gcloud run services update-traffic "$service_name" \
        --to-revisions="$target_revision=50,$current_revision=50" \
        --region="$REGION" \
        --quiet
    
    sleep 120  # Wait 2 minutes
    
    # Monitor for issues
    local service_url
    service_url=$(get_service_url "${service_name%-*}")
    
    if ! comprehensive_health_check "$service_url" "$service_name"; then
        log_error "Health check failed during 50% rollback - aborting"
        return 1
    fi
    
    # Phase 2: 100% traffic to previous revision
    log_info "Phase 2: Shifting 100% traffic to $target_revision"
    gcloud run services update-traffic "$service_name" \
        --to-revisions="$target_revision=100" \
        --region="$REGION" \
        --quiet
    
    sleep 60  # Wait 1 minute for stabilization
    
    return 0
}

verify_rollback_success() {
    local service_name=$1
    local target_revision=$2
    
    log_info "Verifying rollback success for $service_name"
    
    # Check that traffic is directed to target revision
    local current_traffic_revision
    current_traffic_revision=$(gcloud run services describe "$service_name" \
        --region="$REGION" \
        --format="value(status.traffic[0].revisionName)" 2>/dev/null || echo "")
    
    if [[ "$current_traffic_revision" != "$target_revision" ]]; then
        log_error "Traffic not directed to target revision. Current: $current_traffic_revision, Expected: $target_revision"
        return 1
    fi
    
    # Perform comprehensive health check
    local service_url
    service_url=$(get_service_url "${service_name%-*}")
    
    if ! comprehensive_health_check "$service_url" "$service_name"; then
        log_error "Health check failed after rollback"
        return 1
    fi
    
    # Monitor metrics for a short period
    log_info "Monitoring metrics for 5 minutes post-rollback..."
    sleep 300
    
    # Check error rate post-rollback
    local post_rollback_error_rate
    post_rollback_error_rate=$(get_error_rate "${service_name%-*}" "5m")
    
    if [[ $(echo "$post_rollback_error_rate > 0.02" | bc -l) -eq 1 ]]; then
        log_warning "Error rate still elevated post-rollback: ${post_rollback_error_rate}%"
        return 1
    fi
    
    log_success "Rollback verification successful for $service_name"
    return 0
}

# Emergency procedures
emergency_rollback() {
    local service_name=$1
    local failed_revision=$2
    
    log_error "Initiating emergency rollback for $service_name"
    
    # Get the oldest stable revision as last resort
    local emergency_revision
    emergency_revision=$(gcloud run revisions list \
        --service="$service_name" \
        --region="$REGION" \
        --format="value(metadata.name)" \
        --sort-by="metadata.creationTimestamp" \
        --limit=10 | tail -n1)
    
    if [[ -n "$emergency_revision" && "$emergency_revision" != "$failed_revision" ]]; then
        log_info "Emergency rollback to oldest stable revision: $emergency_revision"
        
        gcloud run services update-traffic "$service_name" \
            --to-revisions="$emergency_revision=100" \
            --region="$REGION" \
            --quiet
        
        # Notify operations team
        send_emergency_notification "$service_name" "$failed_revision" "$emergency_revision"
    else
        log_error "No suitable emergency revision found for $service_name"
        send_critical_alert "$service_name"
    fi
}

# Backup and recovery functions
create_rollback_backup() {
    local service_name=$1
    local revision_name=$2
    
    log_info "Creating rollback backup for $service_name revision $revision_name"
    
    # Export current service configuration
    gcloud run services describe "$service_name" \
        --region="$REGION" \
        --format="export" > "backup-${service_name}-${revision_name}-$(date +%Y%m%d_%H%M%S).yaml"
    
    # Store in Cloud Storage for persistence
    if gsutil ls "gs://${PROJECT_ID}-rollback-backups" > /dev/null 2>&1; then
        gsutil cp "backup-${service_name}-${revision_name}-$(date +%Y%m%d_%H%M%S).yaml" \
            "gs://${PROJECT_ID}-rollback-backups/$(date +%Y/%m/%d)/"
    fi
}

# Database backup and restore
backup_database() {
    log_info "Creating database backup before rollback"
    
    # For Firestore, export to Cloud Storage
    local backup_name="rollback-backup-$(date +%Y%m%d_%H%M%S)"
    
    gcloud firestore export "gs://${PROJECT_ID}-database-backups/${backup_name}" \
        --project="$PROJECT_ID" 2>/dev/null || log_warning "Database backup failed"
    
    echo "$backup_name"
}

restore_database() {
    local backup_name=$1
    
    log_warning "Initiating database restore from backup: $backup_name"
    
    # This is a critical operation - require explicit confirmation
    if [[ "$ROLLBACK_REASON" != "automated" ]]; then
        read -p "Are you sure you want to restore the database? This cannot be undone. (yes/no): " confirm
        if [[ "$confirm" != "yes" ]]; then
            log_info "Database restore cancelled by user"
            return 1
        fi
    fi
    
    gcloud firestore import "gs://${PROJECT_ID}-database-backups/${backup_name}" \
        --project="$PROJECT_ID" || log_error "Database restore failed"
}

# Notification functions
send_emergency_notification() {
    local service_name=$1
    local failed_revision=$2
    local emergency_revision=$3
    
    local message="🚨 EMERGENCY ROLLBACK EXECUTED
Service: $service_name
Environment: $ENVIRONMENT
Failed Revision: $failed_revision
Emergency Revision: $emergency_revision
Time: $(date -u)
Reason: $ROLLBACK_REASON

Immediate investigation required!"
    
    # Send to Slack
    if [[ -n "${EMERGENCY_SLACK_WEBHOOK:-}" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"$message\"}" \
            "$EMERGENCY_SLACK_WEBHOOK" || true
    fi
    
    # Send to PagerDuty
    if [[ -n "${PAGERDUTY_ROUTING_KEY:-}" ]]; then
        curl -X POST \
            -H 'Content-Type: application/json' \
            -d "{
                \"routing_key\": \"$PAGERDUTY_ROUTING_KEY\",
                \"event_action\": \"trigger\",
                \"dedup_key\": \"rollback-$service_name-$(date +%s)\",
                \"payload\": {
                    \"summary\": \"Emergency rollback executed for $service_name\",
                    \"source\": \"Travel Planner Rollback System\",
                    \"severity\": \"critical\",
                    \"custom_details\": {
                        \"service\": \"$service_name\",
                        \"environment\": \"$ENVIRONMENT\",
                        \"failed_revision\": \"$failed_revision\",
                        \"emergency_revision\": \"$emergency_revision\"
                    }
                }
            }" \
            'https://events.pagerduty.com/v2/enqueue' || true
    fi
    
    log_info "Emergency notifications sent"
}

send_critical_alert() {
    local service_name=$1
    
    local message="🔥 CRITICAL: ROLLBACK FAILED
Service: $service_name
Environment: $ENVIRONMENT
Time: $(date -u)

Service is in failed state with no viable rollback options.
Manual intervention required IMMEDIATELY!"
    
    # Send critical alerts to all channels
    if [[ -n "${EMERGENCY_SLACK_WEBHOOK:-}" ]]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"$message\", \"channel\": \"#incidents\"}" \
            "$EMERGENCY_SLACK_WEBHOOK" || true
    fi
    
    log_error "CRITICAL ALERT: Manual intervention required for $service_name"
}

# Logging and audit functions
log_rollback_event() {
    local service_name=$1
    local from_revision=$2
    local to_revision=$3
    local status=$4
    
    local event_data="{
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"event_type\": \"rollback\",
        \"service\": \"$service_name\",
        \"environment\": \"$ENVIRONMENT\",
        \"from_revision\": \"$from_revision\",
        \"to_revision\": \"$to_revision\",
        \"status\": \"$status\",
        \"reason\": \"$ROLLBACK_REASON\",
        \"initiated_by\": \"$(whoami)\",
        \"project_id\": \"$PROJECT_ID\"
    }"
    
    # Log to Cloud Logging
    echo "$event_data" | gcloud logging write travel-planner-rollback-events - \
        --severity=WARNING || log_warning "Failed to write audit log"
    
    # Store in local audit file
    echo "$event_data" >> "rollback-audit-$(date +%Y%m).log"
}

# Main rollback orchestration
main() {
    log_info "=== Travel Planner Automated Rollback System ==="
    log_info "Environment: $ENVIRONMENT"
    log_info "Reason: $ROLLBACK_REASON"
    log_info "Timestamp: $(date -u)"
    
    # Validations
    validate_environment
    validate_gcp_auth
    
    # Create database backup if needed
    local db_backup=""
    if [[ "$ROLLBACK_REASON" == "data_corruption" ]]; then
        db_backup=$(backup_database)
    fi
    
    local rollback_needed=false
    local rollback_failures=0
    
    # Analyze and execute rollbacks for each service
    for service_type in "${!SERVICES[@]}"; do
        local service_name="${SERVICES[$service_type]}"
        
        log_info "Processing $service_type service: $service_name"
        
        # Check if rollback is necessary
        case $(analyze_rollback_necessity "$service_name") in
            0)  # Rollback needed
                log_info "Rollback required for $service_name"
                rollback_needed=true
                
                if perform_rollback "$service_name"; then
                    log_success "Rollback successful for $service_name"
                else
                    log_error "Rollback failed for $service_name"
                    ((rollback_failures++))
                fi
                ;;
            1)  # Analysis failed
                log_error "Cannot analyze rollback necessity for $service_name"
                ((rollback_failures++))
                ;;
            2)  # No rollback needed
                log_info "No rollback needed for $service_name"
                ;;
        esac
    done
    
    # Final status
    if [[ $rollback_failures -eq 0 ]]; then
        if [[ "$rollback_needed" == true ]]; then
            log_success "All required rollbacks completed successfully"
            exit 0
        else
            log_info "No rollbacks were necessary"
            exit 0
        fi
    else
        log_error "$rollback_failures rollback(s) failed"
        
        # Send critical alert if any rollbacks failed
        send_critical_alert "Multiple services"
        
        exit 1
    fi
}

# Trap for cleanup
cleanup_on_exit() {
    local exit_code=$?
    
    if [[ $exit_code -ne 0 ]]; then
        log_error "Rollback script exited with code: $exit_code"
    fi
    
    # Clean up temporary files
    rm -f backup-*.yaml 2>/dev/null || true
}

trap cleanup_on_exit EXIT

# Command line interface
case "${1:-help}" in
    "production"|"staging"|"development")
        main "$@"
        ;;
    "analyze")
        log_info "Analyzing rollback necessity..."
        for service_type in "${!SERVICES[@]}"; do
            analyze_rollback_necessity "${SERVICES[$service_type]}"
        done
        ;;
    "emergency")
        log_warning "Emergency rollback mode"
        ROLLBACK_REASON="emergency"
        main "production" "emergency"
        ;;
    "help"|*)
        echo "Usage: $0 [environment] [reason]"
        echo ""
        echo "Environments: production, staging, development"
        echo "Special commands:"
        echo "  analyze  - Analyze if rollback is needed"
        echo "  emergency - Execute emergency rollback"
        echo ""
        echo "Examples:"
        echo "  $0 production high_error_rate"
        echo "  $0 staging failed_deployment"
        echo "  $0 analyze"
        echo "  $0 emergency"
        exit 0
        ;;
esac