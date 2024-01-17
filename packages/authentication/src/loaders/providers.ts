import * as defaultProviders from "@providers"

import { LoaderOptions, ModulesSdkTypes } from "@medusajs/types"

import { AwilixContainer, ClassOrFunctionReturning, Resolver, asClass, asFunction, asValue } from "awilix"

export default async ({
  container,
}: LoaderOptions<
  | ModulesSdkTypes.ModuleServiceInitializeOptions
  | ModulesSdkTypes.ModuleServiceInitializeCustomDataLayerOptions
>): Promise<void> => {
  // if(options.providers?.length) {
  // TODO: implement plugin provider registration
  // }

  const providersToLoad = Object.values(defaultProviders)

  for (const provider of providersToLoad) {
    container.register({
      [`auth_provider_${provider.PROVIDER}`]: asClass(provider).singleton(),
    })
  }

  container.register({
    [`auth_providers`]: asArray(providersToLoad),
  })
}

function asArray(
  resolvers: (ClassOrFunctionReturning<unknown> | Resolver<unknown>)[]
): { resolve: (container: AwilixContainer) => unknown[] } {
  return {
    resolve: (container: AwilixContainer) =>
      resolvers.map((resolver) => container.build(resolver)),
  }
}
