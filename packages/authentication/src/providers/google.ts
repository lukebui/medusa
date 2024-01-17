import {
  AbstractAuthenticationModuleProvider,
  AuthenticationResponse,
} from "@medusajs/types"
import { AuthProviderService, AuthUserService } from "@services"

import { OAuth2 } from "oauth"
import url, { UrlWithParsedQuery } from "url"
import jwt, { JwtPayload } from "jsonwebtoken"
import { MedusaError } from "@medusajs/utils"
import { TreeLevelColumn } from "typeorm"

type InjectedDependencies = {
  authUserService: AuthUserService
  authProviderService: AuthProviderService
}

type GoogleProviderConfig = {
  callbackURL: string
  clientID: string
  clientSecret: string
}

class GoogleProvider extends AbstractAuthenticationModuleProvider {
  public static PROVIDER = "google"
  public static DISPLAY_NAME = "Google Authentication"

  private authorizationUrl_ = "https://accounts.google.com/o/oauth2/v2/auth"
  private tokenUrl_ = "https://www.googleapis.com/oauth2/v4/token"

  protected readonly authUserSerivce_: AuthUserService
  protected readonly authProviderService_: AuthProviderService

  constructor({ authUserService, authProviderService }: InjectedDependencies) {
    super()

    this.authUserSerivce_ = authUserService
    this.authProviderService_ = authProviderService
  }

  private async validateConfig(config: Partial<GoogleProviderConfig>) {
    if (!config.clientID) {
      throw new Error("Google clientID is required")
    }

    if (!config.clientSecret) {
      throw new Error("Google clientSecret is required")
    }

    if (!config.callbackURL) {
      throw new Error("Google callbackUrl is required")
    }
  }

  private originalURL(req) {
    var tls = req.connection.encrypted,
      host = req.headers.host,
      protocol = tls ? "https" : "http",
      path = req.url || ""
    return protocol + "://" + host + path
  }

  async verify_(request, accessToken, refreshToken) {
    // decode email from jwt
    const jwtData = (await jwt.decode(refreshToken.id_token, {
      complete: true,
    })) as JwtPayload | null
    // const email = jwtData!.email
    const entity_id = jwtData!.payload.email

    let authUser

    try {
      authUser = await this.authUserSerivce_.retrieveByProviderAndEntityId(
        entity_id,
        GoogleProvider.PROVIDER
      )
    } catch (error) {
      if (error.type === MedusaError.Types.NOT_FOUND) {
        authUser = await this.authUserSerivce_.create([
          {
            entity_id,
            provider_id: GoogleProvider.PROVIDER,
            user_metadata: jwtData!.payload,
          },
        ])
      } else {
        return { success: false, error: error.message }
      }
    }

    return { success: true, authUser }
  }

  async getProviderConfig(
    req: Record<string, unknown>
  ): Promise<GoogleProviderConfig> {
    const { config } = await this.authProviderService_.retrieve(
      GoogleProvider.PROVIDER
    )

    this.validateConfig(config || {})

    const { callbackURL } = config as GoogleProviderConfig

    const cbUrl = !url.parse(callbackURL).protocol
      ? url.resolve(this.originalURL(req), callbackURL)
      : callbackURL

    return {...config, callbackURL: cbUrl } as GoogleProviderConfig
  }

  async authenticate(
    userData: Record<string, any>
  ): Promise<AuthenticationResponse> {
    const req = userData

    if (req.query && req.query.error) {
      return {
        success: false,
        error: `${req.query.error_description}, read more at: ${req.query.error_uri}`,
      }
    }

    let config

    try {
      config = await this.getProviderConfig(req)
    } catch (error) {
      return { success: false, error: error.message }
    }

    let { callbackURL, clientID, clientSecret } = config

    var meta = {
      authorizationURL: this.authorizationUrl_,
      tokenURL: this.tokenUrl_,
      clientID,
      callbackURL,
      clientSecret,
    }

    const code = (req.query && req.query.code) || (req.body && req.body.code)

    // Redirect to google
    if (!code) {
      return this.getRedirect(meta)
    }

    return await this.validateCallback(code, meta)
  }

  // abstractable
  private async validateCallback(code: string, {
    authorizationURL,
    tokenURL,
    clientID,
    callbackURL,
    clientSecret,
  }: {
    authorizationURL: string
    tokenURL: string
    clientID: string
    callbackURL: string
    clientSecret: string
  }) {
    const oauth2 = new OAuth2(
      clientID,
      clientSecret,
      "",
      authorizationURL,
      tokenURL
    )

    let state = null
    const setState = (newState) => {
      state = newState
    }
   
    try {
      oauth2.getOAuthAccessToken(
        code,
        { grant_type: "authorization_code", redirect_uri: callbackURL },
        this.getOAuthAccessTokenCallback(setState)
      )
    } catch (ex) {
      return { success: false, error: ex }
    }

    // wait for callback to resolve
    while (state === null) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    return state
  }

  private getOAuthAccessTokenCallback(setResult) {
    return async (err, accessToken, refreshToken, params) => {
      const result = await this.oathAccessTokenCallback(
        err,
        accessToken,
        refreshToken,
        params
      )
      setResult(result)
    }
  }

  // abstractable
  private async oathAccessTokenCallback(
    err,
    accessToken,
    refreshToken,
    params
  ) {
    if (err || !accessToken) {
      return {
        success: false,
        error: "Failed to obtain access token",
      }
    }

    try {
      return await this.verify_(accessToken, refreshToken, params)
    } catch (ex) {
      return { error: ex.message, success: false }
    }
  }

  // Abstractable
  private getRedirect({
    authorizationURL,
    clientID,
    callbackURL
  }: {
    authorizationURL: string
    clientID: string
    callbackURL: string
  }) {
    const params: {
      response_type: string
      redirect_uri: string
      scope?: string
    } = {
      response_type: "code",
      scope: "email profile",
      redirect_uri: callbackURL,
    }

    try {
      const parsed: Omit<UrlWithParsedQuery, "search"> & {
        search?: string | null
      } = url.parse(authorizationURL, true)

      for (const key in params) {
        parsed.query[key] = params[key]
      }

      parsed.query["client_id"] = clientID

      delete parsed.search

      var location = url.format(parsed)

      return { success: true, location }
    } catch (ex) {
      return { success: false, error: ex.message }
    }
  }
}

export default GoogleProvider
