import { getNetworkingV1Api, isApiError } from './client'

function policyName(projectId: string): string {
  return `netpol-${projectId}`
}

// Namespace where slipstream-web lives (the release namespace).
const WEB_NAMESPACE = process.env.WEB_NAMESPACE ?? 'slipstream'

// When GATEWAY_PROXY_NAMESPACE is set, ingress to the agent port is restricted
// to pods in that namespace matching the given label. Leave unset on clusters
// where the gateway data-plane runs with hostNetwork (e.g. kind), since
// hostNetwork pods appear as node IPs and cannot be matched by pod selectors.
const GATEWAY_PROXY_NAMESPACE = process.env.GATEWAY_PROXY_NAMESPACE ?? ''
const GATEWAY_PROXY_LABEL_KEY =
  process.env.GATEWAY_PROXY_LABEL_KEY ?? 'gateway.envoyproxy.io/owning-gateway-name'
const GATEWAY_PROXY_LABEL_VALUE =
  process.env.GATEWAY_PROXY_LABEL_VALUE ?? process.env.GATEWAY_NAME ?? ''

function buildIngressRule() {
  if (GATEWAY_PROXY_NAMESPACE) {
    return [
      {
        from: [
          {
            namespaceSelector: {
              matchLabels: { 'kubernetes.io/metadata.name': GATEWAY_PROXY_NAMESPACE },
            },
            podSelector: {
              matchLabels: { [GATEWAY_PROXY_LABEL_KEY]: GATEWAY_PROXY_LABEL_VALUE },
            },
          },
        ],
        ports: [{ protocol: 'TCP', port: 8080 }],
      },
    ]
  }
  // No proxy namespace configured — allow all ingress on the agent port.
  // The agent enforces RS256 JWT on every request.
  return [{ ports: [{ protocol: 'TCP', port: 8080 }] }]
}

/**
 * Creates the project's NetworkPolicy if missing, or replaces it with the
 * current desired spec if it already exists — so spec changes (e.g. selector
 * fixes) are picked up on every project start, not just on first creation.
 */
export async function ensureNetworkPolicy(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getNetworkingV1Api()
  const name = policyName(projectId)

  const body = {
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
      ingress: buildIngressRule(),
      egress: [
        // JWKS endpoint — slipstream-web service on port 80 in the web namespace.
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': WEB_NAMESPACE,
                },
              },
              podSelector: {
                matchLabels: {
                  'app.kubernetes.io/component': 'web',
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
  }

  try {
    await api.createNamespacedNetworkPolicy({ namespace: k8sNamespace, body })
  } catch (e) {
    if (!isApiError(e, 409)) throw e
    const current = await api.readNamespacedNetworkPolicy({ name, namespace: k8sNamespace })
    await api.replaceNamespacedNetworkPolicy({
      name,
      namespace: k8sNamespace,
      body: {
        ...body,
        metadata: { ...body.metadata, resourceVersion: current.metadata?.resourceVersion },
      },
    })
  }
}

export async function deleteNetworkPolicy(k8sNamespace: string, projectId: string): Promise<void> {
  const api = getNetworkingV1Api()
  const name = policyName(projectId)

  await api.deleteNamespacedNetworkPolicy({
    name,
    namespace: k8sNamespace,
  })
}
