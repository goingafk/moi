import type { RoutingSettings } from '@/lib/types'

import { createJevClassifier } from './jev'
import { createLayaClassifier } from './laya'
import { RouteClassifierError, type Classification, type RouteClassifier } from './types'

type ClassifyOptions = {
  classifiers?: Partial<Record<'jev' | 'laya', RouteClassifier>>
}

export async function classifyRoute(
  input: { message: string; project: string },
  settings: RoutingSettings,
  options: ClassifyOptions = {}
): Promise<Classification> {
  const classifiers: Partial<Record<'jev' | 'laya', RouteClassifier>> = {
    jev: options.classifiers?.jev ?? createJevClassifier(),
    ...(settings.laya
      ? {
          laya:
            options.classifiers?.laya ??
            createLayaClassifier({ baseUrl: settings.laya.baseUrl, model: settings.laya.model })
        }
      : options.classifiers?.laya
        ? { laya: options.classifiers.laya }
        : {})
  }
  const order = [settings.classifier, settings.classifier === 'jev' ? 'laya' : 'jev'] as const
  const errors: string[] = []
  for (const id of order) {
    const classifier = classifiers[id]
    if (!classifier || !(await classifier.configured())) continue
    try {
      return await classifier.classify(input)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new RouteClassifierError(errors.join('; ') || 'No routing classifier is configured')
}
