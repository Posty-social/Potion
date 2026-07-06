import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

const nullableTimestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [uniqueIndex('user_email_idx').on(table.email)],
)

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at'),
    token: text('token').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activeOrganizationId: text('active_organization_id'),
  },
  (table) => [
    uniqueIndex('session_token_idx').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: nullableTimestamp('access_token_expires_at'),
    refreshTokenExpiresAt: nullableTimestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const organization = sqliteTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at'),
  },
  (table) => [uniqueIndex('organization_slug_idx').on(table.slug)],
)

export const member = sqliteTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    index('member_user_id_idx').on(table.userId),
    uniqueIndex('member_org_user_idx').on(table.organizationId, table.userId),
  ],
)

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at'),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_org_id_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

export const apikey = sqliteTable(
  'apikey',
  {
    id: text('id').primaryKey(),
    configId: text('config_id').notNull().default('default'),
    name: text('name'),
    start: text('start'),
    referenceId: text('reference_id').notNull(),
    prefix: text('prefix'),
    key: text('key').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: nullableTimestamp('last_refill_at'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    rateLimitEnabled: integer('rate_limit_enabled', { mode: 'boolean' })
      .notNull()
      .default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').notNull().default(0),
    remaining: integer('remaining'),
    lastRequest: nullableTimestamp('last_request'),
    expiresAt: nullableTimestamp('expires_at'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    permissions: text('permissions'),
    metadata: text('metadata'),
  },
  (table) => [
    index('apikey_config_id_idx').on(table.configId),
    index('apikey_reference_id_idx').on(table.referenceId),
    index('apikey_key_idx').on(table.key),
  ],
)

export const oauthApplication = sqliteTable(
  'oauth_application',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    icon: text('icon'),
    metadata: text('metadata'),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret'),
    redirectUrls: text('redirect_urls').notNull(),
    type: text('type').notNull(),
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    uniqueIndex('oauth_application_client_id_idx').on(table.clientId),
    index('oauth_application_user_id_idx').on(table.userId),
  ],
)

export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    uniqueIndex('oauth_access_token_access_token_idx').on(table.accessToken),
    uniqueIndex('oauth_access_token_refresh_token_idx').on(table.refreshToken),
    index('oauth_access_token_client_id_idx').on(table.clientId),
    index('oauth_access_token_user_id_idx').on(table.userId),
  ],
)

export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthApplication.clientId, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scopes: text('scopes').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
    consentGiven: integer('consent_given', { mode: 'boolean' }).notNull(),
  },
  (table) => [
    index('oauth_consent_client_id_idx').on(table.clientId),
    index('oauth_consent_user_id_idx').on(table.userId),
  ],
)
