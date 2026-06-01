import { getNetworkingV1Api } from './client'

function policyName(projectId: string): string {
  return `netpol-${projectId}`
}

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
            from: [
              {
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
          // Allow to slipstream-web service on port 443 (for JWKS)
          {
            to: [
              {
                podSelector: {
                  matchLabels: {
                    'app': 'slipstream-web',
                  },
                },
              },
            ],
            ports: [{ protocol: 'TCP', port: 443 as any }],
          },
          // Allow to VictoriaMetrics on port 8428
          {
            to: [
              {
                podSelector: {
                  matchLabels: {
                    app: 'victoriametrics',
                  },
                },
              },
            ],
            ports: [{ protocol: 'TCP', port: 8428 as any }],
          },
          // Allow external (non-RFC1918) traffic on ports 80 and 443
          // Achieved by allowing 0.0.0.0/0 and then blocking RFC1918 ranges via except
          {
            to: [
              {
                ipBlock: {
                  cidr: '0.0.0.0/0',
                  except: [
                    '10.0.0.0/8',
                    '172.16.0.0/12',
                    '192.168.0.0/16',
                  ],
                },
              },
            ],
            ports: [
              { protocol: 'TCP', port: 80 as any },
              { protocol: 'TCP', port: 443 as any },
            ],
          },
          // Allow DNS to kube-dns
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
            ports: [{ protocol: 'UDP', port: 53 as any }],
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
