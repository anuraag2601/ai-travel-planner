terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.4"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
  
  # Store Terraform state in Google Cloud Storage with enhanced configuration
  backend "gcs" {
    bucket                      = "travel-planner-terraform-state"
    prefix                      = "terraform/state"
    impersonate_service_account = null
  }
}

# Configure the Google Cloud Provider
provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# Enable required APIs
resource "google_project_service" "apis" {
  for_each = toset([
    "cloudbuild.googleapis.com",
    "run.googleapis.com",
    "containerregistry.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com"
  ])
  
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# Create Firestore database
resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"
  
  depends_on = [google_project_service.apis]
}

# Service accounts
resource "google_service_account" "backend" {
  account_id   = "travel-planner-backend"
  display_name = "Travel Planner Backend Service Account"
  description  = "Service account for the Travel Planner backend API"
}

resource "google_service_account" "frontend" {
  account_id   = "travel-planner-frontend"
  display_name = "Travel Planner Frontend Service Account"
  description  = "Service account for the Travel Planner frontend"
}

# IAM bindings for backend service account
resource "google_project_iam_member" "backend_datastore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Secrets in Secret Manager
resource "google_secret_manager_secret" "secrets" {
  for_each = toset([
    "anthropic-api-key",
    "amadeus-client-id",
    "amadeus-client-secret",
    "jwt-secret",
    "sendgrid-api-key",
    "firebase-service-account"
  ])
  
  secret_id = each.value
  
  replication {
    auto {}
  }
  
  depends_on = [google_project_service.apis]
}

# Cloud Run services
resource "google_cloud_run_service" "backend" {
  name     = "travel-planner-api"
  location = var.region
  
  template {
    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "10"
        "autoscaling.knative.dev/minScale" = "0"
        "run.googleapis.com/cpu-throttling" = "false"
      }
      labels = {
        app       = "travel-planner"
        component = "backend"
      }
    }
    
    spec {
      service_account_name = google_service_account.backend.email
      container_concurrency = 80
      timeout_seconds = 300
      
      containers {
        image = "gcr.io/${var.project_id}/travel-planner-api:latest"
        
        ports {
          container_port = 8080
        }
        
        resources {
          limits = {
            cpu    = "2"
            memory = "2Gi"
          }
          requests = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
        
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        
        env {
          name  = "PORT"
          value = "8080"
        }
        
        env {
          name  = "FIRESTORE_PROJECT_ID"
          value = var.project_id
        }
        
        env {
          name  = "CORS_ORIGIN"
          value = google_cloud_run_service.frontend.status[0].url
        }
        
        env {
          name  = "RATE_LIMIT_ENABLED"
          value = "true"
        }
        
        env {
          name  = "SECURITY_HEADERS_ENABLED"
          value = "true"
        }
        
        # Secrets from Secret Manager
        dynamic "env" {
          for_each = {
            "ANTHROPIC_API_KEY"     = "anthropic-api-key"
            "AMADEUS_CLIENT_ID"     = "amadeus-client-id"
            "AMADEUS_CLIENT_SECRET" = "amadeus-client-secret"
            "JWT_SECRET"            = "jwt-secret"
            "SENDGRID_API_KEY"      = "sendgrid-api-key"
          }
          
          content {
            name = env.key
            value_from {
              secret_key_ref {
                name = google_secret_manager_secret.secrets[env.value].secret_id
                key  = "latest"
              }
            }
          }
        }
      }
    }
  }
  
  traffic {
    percent         = 100
    latest_revision = true
  }
  
  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_service" "frontend" {
  name     = "travel-planner-web"
  location = var.region
  
  template {
    metadata {
      annotations = {
        "autoscaling.knative.dev/maxScale" = "5"
        "autoscaling.knative.dev/minScale" = "0"
      }
      labels = {
        app       = "travel-planner"
        component = "frontend"
      }
    }
    
    spec {
      container_concurrency = 100
      timeout_seconds = 60
      
      containers {
        image = "gcr.io/${var.project_id}/travel-planner-web:latest"
        
        ports {
          container_port = 80
        }
        
        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
          requests = {
            cpu    = "0.5"
            memory = "256Mi"
          }
        }
        
        env {
          name  = "VITE_API_BASE_URL"
          value = "${google_cloud_run_service.backend.status[0].url}/api/v1"
        }
      }
    }
  }
  
  traffic {
    percent         = 100
    latest_revision = true
  }
  
  depends_on = [google_project_service.apis]
}

# Cloud Run IAM - Restricted public access with authentication for backend
# Frontend can remain public for web access
resource "google_cloud_run_service_iam_member" "frontend_public" {
  location = google_cloud_run_service.frontend.location
  project  = google_cloud_run_service.frontend.project
  service  = google_cloud_run_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Backend API access should be controlled through proper authentication
# Remove allUsers access and implement proper auth at application level
# For demo purposes only - in production, consider using Cloud Load Balancer with IAP
resource "google_cloud_run_service_iam_member" "backend_public" {
  count    = var.enable_public_backend_access ? 1 : 0
  location = google_cloud_run_service.backend.location
  project  = google_cloud_run_service.backend.project
  service  = google_cloud_run_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# More secure approach: Allow only specific service accounts
resource "google_cloud_run_service_iam_member" "backend_frontend_access" {
  count    = var.enable_public_backend_access ? 0 : 1
  location = google_cloud_run_service.backend.location
  project  = google_cloud_run_service.backend.project
  service  = google_cloud_run_service.backend.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.frontend.email}"
}

# Cloud Build triggers for CI/CD
resource "google_cloudbuild_trigger" "backend_trigger" {
  name = "travel-planner-backend-deploy"
  
  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = "^main$"
    }
  }
  
  filename = "backend/cloudbuild.yaml"
  
  substitutions = {
    _SERVICE_NAME = google_cloud_run_service.backend.name
    _REGION       = var.region
  }
}

resource "google_cloudbuild_trigger" "frontend_trigger" {
  name = "travel-planner-frontend-deploy"
  
  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = "^main$"
    }
  }
  
  filename = "frontend/cloudbuild.yaml"
  
  substitutions = {
    _SERVICE_NAME = google_cloud_run_service.frontend.name
    _REGION       = var.region
  }
}

# Monitoring and alerting
resource "google_monitoring_alert_policy" "high_error_rate" {
  display_name = "High Error Rate - Travel Planner"
  combiner     = "OR"
  
  conditions {
    display_name = "Error rate too high"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 0.05
      
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  
  notification_channels = var.notification_channels
  
  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_alert_policy" "high_latency" {
  display_name = "High Latency - Travel Planner"
  combiner     = "OR"
  
  conditions {
    display_name = "Response latency too high"
    
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${google_cloud_run_service.backend.name}\""
      duration        = "300s"
      comparison      = "COMPARISON_GREATER_THAN"
      threshold_value = 2000
      
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  
  notification_channels = var.notification_channels
  
  alert_strategy {
    auto_close = "1800s"
  }
}

# Create a storage bucket for Terraform state (if it doesn't exist)
resource "google_storage_bucket" "terraform_state" {
  name          = "${var.project_id}-terraform-state"
  location      = var.region
  force_destroy = false
  
  versioning {
    enabled = true
  }
  
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

# Network security policy (optional)
resource "google_compute_security_policy" "policy" {
  name = "travel-planner-security-policy"
  
  rule {
    action   = "allow"
    priority = "1000"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }
  
  rule {
    action   = "deny(403)"
    priority = "2147483647"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default deny rule"
  }
}