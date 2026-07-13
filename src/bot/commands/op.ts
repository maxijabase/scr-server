import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { OperatorKind, OperatorRecord } from '../../store/types.js';
import type { SlashCommandModule } from '../commandModule.js';

function mentionFor(operator: Pick<OperatorRecord, 'discordId' | 'kind'>): string {
  return operator.kind === 'role' ? `<@&${operator.discordId}>` : `<@${operator.discordId}>`;
}

/**
 * Manages the set of Discord users and roles (besides the bot owner)
 * authorized to run "!"-prefixed messages as server commands on linked game
 * servers. Anyone holding an authorized role is treated the same as an
 * individually authorized user -- no need to add each member separately.
 *
 * Every subcommand additionally requires the caller to be the bot owner
 * (SCR_DISCORD_OWNER_ID) -- this is a runtime identity check rather than a
 * Discord permission, since Discord's permission system can't target one
 * specific user id declaratively. `.setDefaultMemberPermissions` below is
 * only a coarse first filter (hides it from regular members) and is not a
 * substitute for the owner check in `execute`.
 */
export const opCommand: SlashCommandModule = {
  data: new SlashCommandBuilder()
    .setName('op')
    .setDescription('Manage Discord users/roles authorized to run !commands on the game server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Authorize a Discord user or role to run !commands')
        .addUserOption((opt) =>
          opt.setName('user').setDescription('The Discord user to authorize'),
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('The Discord role to authorize'),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List authorized operators'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription("Revoke a Discord user's or role's authorization to run !commands")
        .addUserOption((opt) => opt.setName('user').setDescription('The Discord user to revoke'))
        .addRoleOption((opt) => opt.setName('role').setDescription('The Discord role to revoke')),
    ),

  async execute(interaction, ctx) {
    if (!ctx.ownerId) {
      await interaction.reply({
        content: 'SCR_DISCORD_OWNER_ID is not configured -- /op is disabled.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== ctx.ownerId) {
      await interaction.reply({
        content: 'Only the bot owner can manage operators.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const operators = ctx.store.operators.list();

      if (operators.length === 0) {
        await interaction.reply({ content: 'No operators configured.', flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: operators
          .map((op) => `${mentionFor(op)} (${op.kind})`)
          .join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // create/remove share the same "exactly one of user/role" target resolution.
    const user = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');

    if (!user && !role) {
      await interaction.reply({
        content: 'Provide either `user` or `role`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (user && role) {
      await interaction.reply({
        content: 'Provide only one of `user` or `role`, not both.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target: { readonly id: string; readonly kind: OperatorKind } = user
      ? { id: user.id, kind: 'user' }
      : { id: role!.id, kind: 'role' };
    const mention = mentionFor({ discordId: target.id, kind: target.kind });

    if (subcommand === 'create') {
      ctx.store.operators.add(target.id, target.kind, ctx.ownerId);

      await interaction.reply({
        content: `Authorized ${mention} to run !commands.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === 'remove') {
      const removed = ctx.store.operators.remove(target.id, target.kind);

      await interaction.reply({
        content: removed
          ? `Revoked ${mention}'s authorization to run !commands.`
          : `${mention} is not an operator.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
