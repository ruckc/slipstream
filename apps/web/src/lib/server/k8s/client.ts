import * as k8s from '@kubernetes/client-node'

let kc: k8s.KubeConfig | null = null

export function getKubeConfig(): k8s.KubeConfig {
  if (!kc) {
    kc = new k8s.KubeConfig()
    if (process.env.KUBERNETES_SERVICE_HOST) {
      kc.loadFromCluster()
    } else {
      kc.loadFromDefault()
    }
  }
  return kc
}

export function getCoreV1Api(): k8s.CoreV1Api {
  return getKubeConfig().makeApiClient(k8s.CoreV1Api)
}

export function getCustomObjectsApi(): k8s.CustomObjectsApi {
  return getKubeConfig().makeApiClient(k8s.CustomObjectsApi)
}

export function getNetworkingV1Api(): k8s.NetworkingV1Api {
  return getKubeConfig().makeApiClient(k8s.NetworkingV1Api)
}

export function getAppsV1Api(): k8s.AppsV1Api {
  return getKubeConfig().makeApiClient(k8s.AppsV1Api)
}
