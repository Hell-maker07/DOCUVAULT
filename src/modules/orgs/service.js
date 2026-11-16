import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { withTransaction } from '../../config/db.js';
import { config } from '../../config/env.js';
import { newKeyPair, wrap } from '../../utils/keys.js';
import { appendAudit } from '../audit/auditWriter.js';
import { createOrgBootstrap } from './repo.js';

/**
 * Registers an organisation and its root administrator user.
 *
 * @param {object} input Parsed registration payload
 * @param {string|null} [ip] Client IP address
 * @returns {Promise<{ accessToken: string, organization: object, user: object }>}
 */
export async function registerOrganization(input, ip = null) {
  // 1. Hash the administrator password
  const passwordHash = await bcrypt.hash(input.password, 10);

  // 2. Generate Ed25519 signing keypair and encrypt the private key
  const { publicKey, privateKey } = newKeyPair();
  const privateKeyEnc = wrap(privateKey);

  // 3. Atomically persist organisation, department, position, permissions, user and audit log
  const { organization, user } = await withTransaction(async (tx) => {
    const bootstrapped = await createOrgBootstrap(tx, {
      name: input.name,
      orgType: input.orgType,
      departmentCode: input.departmentCode,
      departmentName: input.department,
      adminName: input.adminName,
      email: input.email,
      passwordHash,
      publicKey,
      privateKeyEnc,
    });

    // Append initial bootstrap audit record to the organisation's new audit chain
    await appendAudit(tx, {
      orgId: bootstrapped.organization.id,
      actorId: bootstrapped.user.id,
      action: 'ADMIN_CHANGE',
      entityType: 'ORGANIZATION',
      entityId: bootstrapped.organization.id,
      outcome: 'ALLOWED',
      details: {
        action: 'BOOTSTRAP_ORG',
        orgName: bootstrapped.organization.name,
        adminEmail: bootstrapped.user.email,
        department: bootstrapped.department.name,
      },
      ip,
    });

    return bootstrapped;
  });

  // 4. Issue 1-hour JWT access token for the root administrator
  const accessToken = jwt.sign(
    { sub: user.id },
    config.JWT_SECRET,
    { expiresIn: '1h' },
  );

  return {
    accessToken,
    organization: {
      id: organization.id,
      name: organization.name,
      orgType: organization.org_type,
    },
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
    },
  };
}
