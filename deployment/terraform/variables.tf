# Terraform Variables for Travel Planner Infrastructure

# Project Configuration
variable "project_id" {
  description = "The GCP project ID"
  type        = string
}

variable "region" {
  description = "The GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "The GCP zone for resources"
  type        = string
  default     = "us-central1-a"
}

variable "firestore_location" {
  description = "The location for Firestore database"
  type        = string
  default     = "us-central"
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
  default     = "production"
  
  validation {
    condition     = contains(["production", "staging", "development"], var.environment)
    error_message = "Environment must be one of: production, staging, development."
  }
}

# Application Configuration
variable "app_name" {
  description = "Application name"
  type        = string
  default     = "travel-planner"
}

variable "app_version" {
  description = "Application version"
  type        = string
  default     = "1.0.0"
}

# GitHub Configuration
variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
  default     = "anuraag2601"
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = "ai-travel-planner"
}

# Service Configuration
variable "backend_image" {
  description = "Backend container image"
  type        = string
  default     = "gcr.io/PROJECT_ID/travel-planner-api:latest"
}

variable "frontend_image" {
  description = "Frontend container image"
  type        = string
  default     = "gcr.io/PROJECT_ID/travel-planner-web:latest"
}

# Resource Configuration
variable "backend_cpu" {
  description = "CPU allocation for backend service"
  type        = string
  default     = "2"
}

variable "backend_memory" {
  description = "Memory allocation for backend service"
  type        = string
  default     = "2Gi"
}

variable "frontend_cpu" {
  description = "CPU allocation for frontend service"
  type        = string
  default     = "1"
}

variable "frontend_memory" {
  description = "Memory allocation for frontend service"
  type        = string
  default     = "512Mi"
}

# Scaling Configuration
variable "backend_min_instances" {
  description = "Minimum instances for backend service"
  type        = number
  default     = 1
}

variable "backend_max_instances" {
  description = "Maximum instances for backend service"
  type        = number
  default     = 10
}

variable "frontend_min_instances" {
  description = "Minimum instances for frontend service"
  type        = number
  default     = 1
}

variable "frontend_max_instances" {
  description = "Maximum instances for frontend service"
  type        = number
  default     = 5
}

variable "container_concurrency" {
  description = "Maximum concurrent requests per container"
  type        = number
  default     = 80
}

# Security Configuration
variable "enable_public_backend_access" {
  description = "Enable public access to backend API (should be false for production)"
  type        = bool
  default     = false
}

variable "allowed_cors_origins" {
  description = "List of allowed CORS origins"
  type        = list(string)
  default     = []
}

variable "enable_vpc_connector" {
  description = "Enable VPC connector for private resources"
  type        = bool
  default     = true
}

variable "vpc_connector_name" {
  description = "Name of the VPC connector"
  type        = string
  default     = "travel-planner-connector"
}

# Monitoring Configuration
variable "alert_email_addresses" {
  description = "List of email addresses to receive alerts"
  type        = list(string)
  default     = []
}

variable "slack_webhook_url" {
  description = "Slack webhook URL for notifications"
  type        = string
  default     = ""
  sensitive   = true
}

variable "slack_channel" {
  description = "Slack channel for notifications"
  type        = string
  default     = "#deployments"
}

variable "pagerduty_key" {
  description = "PagerDuty service key for critical alerts"
  type        = string
  default     = ""
  sensitive   = true
}

variable "monitoring_retention_days" {
  description = "Number of days to retain monitoring data"
  type        = number
  default     = 30
}

# Database Configuration
variable "database_backup_schedule" {
  description = "Cron schedule for database backups"
  type        = string
  default     = "0 */4 * * *"  # Every 4 hours
}

variable "database_backup_retention_days" {
  description = "Number of days to retain database backups"
  type        = number
  default     = 30
}

# Storage Configuration
variable "backup_bucket_name" {
  description = "Name of the backup storage bucket"
  type        = string
  default     = ""  # Will be auto-generated if empty
}

variable "backup_bucket_location" {
  description = "Location for backup storage bucket"
  type        = string
  default     = "US"
}

variable "enable_bucket_versioning" {
  description = "Enable versioning on storage buckets"
  type        = bool
  default     = true
}

# Networking Configuration
variable "vpc_name" {
  description = "Name of the VPC network"
  type        = string
  default     = "travel-planner-vpc"
}

variable "subnet_name" {
  description = "Name of the subnet"
  type        = string
  default     = "travel-planner-subnet"
}

variable "subnet_cidr" {
  description = "CIDR block for the subnet"
  type        = string
  default     = "10.0.0.0/24"
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway for private instances"
  type        = bool
  default     = true
}

# CDN Configuration
variable "enable_cdn" {
  description = "Enable Cloud CDN for frontend"
  type        = bool
  default     = true
}

variable "cdn_cache_mode" {
  description = "Cache mode for CDN"
  type        = string
  default     = "CACHE_ALL_STATIC"
}

variable "cdn_default_ttl" {
  description = "Default TTL for CDN cache"
  type        = number
  default     = 3600
}

# Load Balancer Configuration
variable "enable_load_balancer" {
  description = "Enable global load balancer"
  type        = bool
  default     = true
}

variable "ssl_certificate_domains" {
  description = "Domains for SSL certificate"
  type        = list(string)
  default     = []
}

# Disaster Recovery Configuration
variable "enable_multi_region" {
  description = "Enable multi-region deployment for disaster recovery"
  type        = bool
  default     = false
}

variable "dr_region" {
  description = "Disaster recovery region"
  type        = string
  default     = "us-east1"
}

variable "backup_regions" {
  description = "List of regions for backup storage"
  type        = list(string)
  default     = ["us-central1", "us-east1", "europe-west1"]
}

# Performance Configuration
variable "enable_cloud_armor" {
  description = "Enable Cloud Armor for DDoS protection"
  type        = bool
  default     = true
}

variable "rate_limit_requests_per_minute" {
  description = "Rate limit for requests per minute"
  type        = number
  default     = 1000
}

# Logging Configuration
variable "log_retention_days" {
  description = "Number of days to retain logs"
  type        = number
  default     = 30
}

variable "enable_audit_logs" {
  description = "Enable audit logging"
  type        = bool
  default     = true
}

# Cost Optimization
variable "enable_preemptible_instances" {
  description = "Enable preemptible instances for cost savings (development only)"
  type        = bool
  default     = false
}

variable "budget_alert_threshold" {
  description = "Budget alert threshold in USD"
  type        = number
  default     = 1000
}

variable "budget_alert_emails" {
  description = "Email addresses for budget alerts"
  type        = list(string)
  default     = []
}

# Feature Flags
variable "enable_cloud_sql" {
  description = "Enable Cloud SQL instead of Firestore"
  type        = bool
  default     = false
}

variable "enable_memcache" {
  description = "Enable Memcache for caching"
  type        = bool
  default     = true
}

variable "enable_cloud_tasks" {
  description = "Enable Cloud Tasks for async processing"
  type        = bool
  default     = false
}

variable "enable_cloud_scheduler" {
  description = "Enable Cloud Scheduler for cron jobs"
  type        = bool
  default     = true
}

# Development Configuration
variable "enable_debug_mode" {
  description = "Enable debug mode (development environments only)"
  type        = bool
  default     = false
}

variable "skip_deletion_protection" {
  description = "Skip deletion protection (for testing environments)"
  type        = bool
  default     = false
}

# Validation rules
variable "notification_channels" {
  description = "List of notification channel IDs"
  type        = list(string)
  default     = []
}

# Tags and Labels
variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default = {
    project     = "travel-planner"
    managed-by  = "terraform"
    team        = "platform"
  }
}

variable "additional_labels" {
  description = "Additional labels to merge with default labels"
  type        = map(string)
  default     = {}
}