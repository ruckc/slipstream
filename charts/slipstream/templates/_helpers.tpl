{{/*
Expand the name of the chart.
*/}}
{{- define "slipstream.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "slipstream.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels applied to all managed resources.
*/}}
{{- define "slipstream.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | quote }}
{{ include "slipstream.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for the web deployment.
*/}}
{{- define "slipstream.selectorLabels" -}}
app.kubernetes.io/name: {{ include "slipstream.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Full image reference for the web container.
*/}}
{{- define "slipstream.webImage" -}}
{{- printf "%s:%s" .Values.image.web.repository (.Values.image.web.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Full image reference for the agent container.
Written into the ConfigMap so the web app can reference it when launching project pods.
*/}}
{{- define "slipstream.agentImage" -}}
{{- printf "%s:%s" .Values.image.agent.repository (.Values.image.agent.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Full image reference for the project-controller container.
*/}}
{{- define "slipstream.projectControllerImage" -}}
{{- printf "%s:%s" .Values.image.projectController.repository (.Values.image.projectController.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Full image reference for the metrics-collector StatefulSet.
*/}}
{{- define "slipstream.metricsCollectorImage" -}}
{{- printf "%s:%s" .Values.image.metricsCollector.repository (.Values.image.metricsCollector.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Full image reference for the hubble-collector container.
*/}}
{{- define "slipstream.hubbleCollectorImage" -}}
{{- printf "%s:%s" .Values.image.hubbleCollector.repository (.Values.image.hubbleCollector.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Public app URL — used for APP_URL and SvelteKit ORIGIN.
Derived from gateway.hostname when web.appUrl is not set.
*/}}
{{- define "slipstream.appUrl" -}}
{{- if .Values.web.appUrl -}}
{{- .Values.web.appUrl -}}
{{- else -}}
{{- printf "https://%s" .Values.gateway.hostname -}}
{{- end }}
{{- end }}

{{/*
Secret name: either existingSecret or the chart-managed secret.
*/}}
{{- define "slipstream.secretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
slipstream-web-secret
{{- end }}
{{- end }}

{{/*
Name of the TLS Secret created by cert-manager.
*/}}
{{- define "slipstream.tlsSecretName" -}}
{{ include "slipstream.fullname" . }}-tls
{{- end }}

{{/*
Env vars that make DATABASE_URL available in a container.

pgop mode  (database.pgopSecret.secretName set): pulls username/password/host/port
           from the pgop Role credentials secret and assembles DATABASE_URL via
           Kubernetes $(VAR) substitution at pod start time.
Standard mode: single secretKeyRef pointing at DATABASE_URL in the chart secret.
*/}}
{{- define "slipstream.databaseEnv" -}}
{{- if .Values.database.pgopSecret.secretName -}}
- name: _PGOP_HOST
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.pgopSecret.secretName }}
      key: host
- name: _PGOP_PORT
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.pgopSecret.secretName }}
      key: port
- name: _PGOP_USER
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.pgopSecret.secretName }}
      key: username
- name: _PGOP_PASS
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.pgopSecret.secretName }}
      key: password
- name: DATABASE_URL
  value: {{ printf "postgresql://$(_PGOP_USER):$(_PGOP_PASS)@$(_PGOP_HOST):$(_PGOP_PORT)/%s?sslmode=%s" (required "database.pgopSecret.database is required when database.pgopSecret.secretName is set" .Values.database.pgopSecret.database) (.Values.database.pgopSecret.sslmode | default "disable") | quote }}
{{- else -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "slipstream.secretName" . }}
      key: DATABASE_URL
{{- end -}}
{{- end }}
