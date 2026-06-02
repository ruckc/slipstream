import { getNetworkingV1Api } from './client'

function policyName(projectId: string): string {
  return `netpol-${projectId}`
}

// Namespace where the gateway and slipstream-web live.
const SLIPSTREAM_SYSTEM_NS = process.env.GATEWAY_NAMESPACE ?? 'slipstream-system'

export async function createNetworkPolicy(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getNetworkingV1Api()
  const name = policyName(projectId)

  await api.createNamespacedNetworkPolicy({
    namespace: k8sNamespace,
    body: {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name,
        namespace: k8sNamespace,
        labels: {
          'slipstream.io/project': projectId,
        },
      },
      spec: {
        podSelector: {
          matchLabels: {
            'slipstream.io/project': projectId,
          },
        },
        policyTypes: ['Ingress', 'Egress'],
        ingress: [
          {
            _from: [
              {
                // Only accept traffic from the gateway pod in slipstream-system.
                namespaceSelector: {
                  matchLabels: {
                    'kubernetes.io/metadata.name': SLIPSTREAM_SYSTEM_NS,
                  },
                },
                podSelector: {
                  matchLabels: {
                    app: 'slipstream-gateway',
                  },
                },
              },
            ],
          },
        ],
        egress: [
          // JWKS endpoint — slipstream-web in slipstream-system, port 80 (HTTP).
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    'kubernetes.io/metadata.name': SLIPSTREAM_SYSTEM_NS,
                  },
                },
                podSelector: {
                  matchLabels: {
                    app: 'slipstream-web',
                  },
                },
              },
            ],
            ports: [{ protocol: 'TCP', port: 80 }],
          },
          // VictoriaMetrics metrics push.
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    'kubernetes.io/metadata.name': 'metrics',
                  },
                },
                podSelector: {
                  matchLabels: {
                    app: 'victoriametrics',
                  },
                },
              },
            ],
            ports: [{ protocol: 'TCP', port: 8428 }],
          },
          // Internet egress on HTTP/HTTPS, excluding RFC1918 and link-local (IMDS).
          {
            to: [
              {
                ipBlock: {
                  cidr: '0.0.0.0/0',
                  except: [
                    '10.0.0.0/8',
                    '172.16.0.0/12',
                    '192.168.0.0/16',
                    '169.254.0.0/16', // link-local / cloud IMDS
                  ],
                },
              },
            ],
            ports: [
              { protocol: 'TCP', port: 80 },
              { protocol: 'TCP', port: 443 },
            ],
          },
          // DNS.
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: {
                    'kubernetes.io/metadata.name': 'kube-system',
                  },
                },
                podSelector: {
                  matchLabels: {
                    'k8s-app': 'kube-dns',
                  },
                },
              },
            ],
            ports: [{ protocol: 'UDP', port: 53 }],
          },
        ],
      },
    },
  })
}

export async function deleteNetworkPolicy(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getNetworkingV1Api()
  const name = policyName(projectId)

  await api.deleteNamespacedNetworkPolicy({
    name,
    namespace: k8sNamespace,
  })
}
