require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// === COLOQUE O ID DO SEU CARGO FIXO AQUI ===
const CARGO_JOGADORES_ID = '1475291993084137532';

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel] 
});

// Banco de Memória
const sessionCache = new Map();
const activeMissions = new Map();

// --- SISTEMA DE RECOMPENSAS ---
const tabelaRecompensas = {
    1: { xp: 500, dinheiro: 50 }, 2: { xp: 950, dinheiro: 75 }, 3: { xp: 1400, dinheiro: 100 }, 4: { xp: 1700, dinheiro: 250 },
    5: { xp: 2150, dinheiro: 375 }, 6: { xp: 2400, dinheiro: 500 }, 7: { xp: 2650, dinheiro: 625 }, 8: { xp: 2850, dinheiro: 750 },
    9: { xp: 3200, dinheiro: 1000 }, 10: { xp: 3350, dinheiro: 1500 }, 11: { xp: 3650, dinheiro: 2000 }, 12: { xp: 3800, dinheiro: 2500 },
    13: { xp: 4100, dinheiro: 3250 }, 14: { xp: 4200, dinheiro: 4250 }, 15: { xp: 4300, dinheiro: 5500 }, 16: { xp: 4350, dinheiro: 7750 },
    17: { xp: 4650, dinheiro: 10000 }, 18: { xp: 4700, dinheiro: 12500 }, 19: { xp: 4950, dinheiro: 15000 }, 20: { xp: 5000, dinheiro: 18000 }
};

const modificadores = {
    'normal': { mult: 1.0, nome: 'Normal' },
    'dificil': { mult: 1.1, nome: 'Difícil (+10%)' },
    'tormenta': { mult: 1.2, nome: 'Tormenta (+20%)' }
};

// --- FUNÇÃO AUXILIAR: DESENHAR MENSAGEM NO MURAL ---
function buildMissionMessage(missionId, m) {
    const listaVagas = [];
    for (let i = 0; i < m.vagasTotais; i++) {
        listaVagas.push(m.jogadoresAceitos[i] ? `• <@${m.jogadoresAceitos[i]}>` : `• Vazio`);
    }
    
    const mencao = CARGO_JOGADORES_ID !== 'COLE_O_ID_AQUI' && !m.concluida ? `<@&${CARGO_JOGADORES_ID}>\n\n` : '';
    const statusTag = m.concluida ? `✅ **[MISSÃO CONCLUÍDA]**\n\n` : '';
    
    // Calcula a margem de ND permitida (+1 e -1, limitando entre 1 e 20)
    const ndMin = Math.max(1, m.nd - 1);
    const ndMax = Math.min(20, m.nd + 1);
    
    const content = `${statusTag}- **Missão:** ${m.nome}\n- **Data e Hora:** ${m.dataHora}\n- **Mestre:** <@${m.gmId}>\n- **Nível de Desafio:** ND ${ndMin} - ND ${ndMax}\n- **Dificuldade:** ${modificadores[m.dif].nome}\n\n${mencao}**Vagas:** ${m.jogadoresAceitos.length}/${m.vagasTotais}\n${listaVagas.join('\n')}`;
    
    const embed = new EmbedBuilder().setColor(m.concluida ? '#2ECC71' : '#1C1C28').addFields(
        { name: 'Estilo de Jogo e Enredo', value: m.enredo, inline: false },
        { name: 'Observações', value: m.obs, inline: false }
    );

    if (m.concluida) {
        // O cálculo ainda usa a base exata (m.nd) para a recompensa correta
        const xpBase = tabelaRecompensas[m.nd].xp;
        const dinBase = tabelaRecompensas[m.nd].dinheiro;
        const mult = modificadores[m.dif].mult;

        const xpFinal = Math.floor(xpBase * mult);
        const dinFinal = Math.floor(dinBase * mult);

        const textoJogadores = `**XP:** ${xpFinal}\n**Dinheiro:** T$ ${dinFinal}`;
        const textoMestre = `**XP:** ${Math.floor(xpFinal / 2)}\n**Dinheiro:** T$ ${Math.floor(dinFinal / 2)}`;

        embed.addFields(
            { name: '🎁 Recompensas dos Jogadores', value: textoJogadores, inline: true },
            { name: '👑 Recompensa do Mestre', value: textoMestre, inline: true }
        );
        return { content, embeds: [embed], components: [] };
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`join_${missionId}`).setLabel('Participar').setStyle(ButtonStyle.Primary)
    );

    return { content, embeds: [embed], components: [row] };
}

// --- FUNÇÃO AUXILIAR: DESENHAR PAINEL DO MESTRE NA DM ---
function buildGmPanel(missionId, m) {
    const rowNd = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`selnd_${missionId}`).setPlaceholder(`ND Base Atual: ${m.nd}`).addOptions(
            Array.from({ length: 20 }, (_, i) => ({ label: `Missão ND ${i + 1}`, value: `${i + 1}` }))
        )
    );
    const rowDif = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`seldif_${missionId}`).setPlaceholder(`Dificuldade Atual: ${modificadores[m.dif].nome}`).addOptions([
            { label: 'Normal (100% Recompensa)', value: 'normal' },
            { label: 'Difícil (110% Recompensa)', value: 'dificil' },
            { label: 'Tormenta (120% Recompensa)', value: 'tormenta' }
        ])
    );
    const rowBtns = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`edit_${missionId}`).setLabel('📝 Editar Textos').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`complete_${missionId}`).setLabel('✅ Concluir Missão').setStyle(ButtonStyle.Success)
    );

    return {
        content: `📝 **Painel do Mestre**\nUse os menus abaixo para configurar os aspectos de sistema, ou edite os textos da missão. A missão no mural atualizará automaticamente!\nLink do Mural: https://discord.com/channels/${m.guildId}/${m.channelId}/${missionId}`,
        embeds: buildMissionMessage(missionId, m).embeds,
        components: [rowNd, rowDif, rowBtns]
    };
}

const ndChoices = Array.from({ length: 20 }, (_, i) => ({ name: `ND ${i + 1}`, value: i + 1 }));

const commands = [
    new SlashCommandBuilder()
        .setName('recompensa')
        .setDescription('Calcula o XP e o Dinheiro da missão.')
        .addIntegerOption(opt => opt.setName('nd').setDescription('ND (1 a 20)').setRequired(true).setMinValue(1).setMaxValue(20))
        .addStringOption(opt => opt.setName('dificuldade').setDescription('Dificuldade').setRequired(true)
            .addChoices({ name: 'Normal', value: 'normal' }, { name: 'Difícil', value: 'dificil' }, { name: 'Tormenta', value: 'tormenta' })),
    
    new SlashCommandBuilder()
        .setName('criarmissao')
        .setDescription('Abre o formulário para criar uma missão no mural.')
        .addIntegerOption(opt => opt.setName('nd').setDescription('Nível de Desafio Base').setRequired(true).addChoices(...ndChoices))
        .addStringOption(opt => opt.setName('dificuldade').setDescription('Dificuldade').setRequired(true)
            .addChoices({ name: 'Normal', value: 'normal' }, { name: 'Difícil', value: 'dificil' }, { name: 'Tormenta', value: 'tormenta' }))
        .addStringOption(opt => opt.setName('data_hora').setDescription('Data e horário da sessão').setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(token);

client.once('ready', async () => {
    console.log(`Bot online como ${client.user.tag}!`);
    try {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log('Comandos registrados!');
    } catch (error) {
        console.error(error);
    }
});

client.on('interactionCreate', async interaction => {

    // === COMANDOS DE BARRA ===
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'recompensa') {
            const nd = interaction.options.getInteger('nd');
            const dif = interaction.options.getString('dificuldade');
            const xpFinal = Math.floor(tabelaRecompensas[nd].xp * modificadores[dif].mult);
            const dinFinal = Math.floor(tabelaRecompensas[nd].dinheiro * modificadores[dif].mult);

            const embed = new EmbedBuilder().setColor('#D0021B').setTitle(`Recompensa | ND ${nd}`).addFields(
                { name: 'Dificuldade', value: modificadores[dif].nome, inline: false },
                { name: 'Experiência', value: `${xpFinal} XP`, inline: true },
                { name: 'Dinheiro', value: `T$ ${dinFinal}`, inline: true }
            );
            await interaction.reply({ embeds: [embed] });
        }

        if (interaction.commandName === 'criarmissao') {
            const nd = interaction.options.getInteger('nd');
            const dif = interaction.options.getString('dificuldade');
            const dataHora = interaction.options.getString('data_hora');
            const sessionId = interaction.id;
            
            sessionCache.set(sessionId, { nd, dif, dataHora });

            const modal = new ModalBuilder().setCustomId(`modal_missao_${sessionId}`).setTitle('Criar Missão');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome da Missão').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vagas').setLabel('Vagas (1 a 6)').setPlaceholder('Ex: 4').setStyle(TextInputStyle.Short).setMaxLength(1).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('enredo').setLabel('Estilo de Jogo e Enredo').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('observacoes').setLabel('Observações').setStyle(TextInputStyle.Paragraph).setRequired(false))
            );
            await interaction.showModal(modal);
        }
    }

    // === MODAIS ===
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_missao_')) {
            const sessionId = interaction.customId.split('_')[2];
            const sessionData = sessionCache.get(sessionId) || { nd: 1, dif: 'normal', dataHora: '?' };

            let vagas = parseInt(interaction.fields.getTextInputValue('vagas'));
            if (isNaN(vagas) || vagas < 1) vagas = 1;
            if (vagas > 6) vagas = 6;

            const missionData = {
                gmId: interaction.user.id,
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                nd: sessionData.nd,
                dif: sessionData.dif,
                dataHora: sessionData.dataHora,
                nome: interaction.fields.getTextInputValue('nome'),
                vagasTotais: vagas,
                enredo: interaction.fields.getTextInputValue('enredo'),
                obs: interaction.fields.getTextInputValue('observacoes') || 'Nenhuma.',
                jogadoresAceitos: [],
                concluida: false
            };

            const missionMessage = await interaction.reply({ ...buildMissionMessage('temp', missionData), fetchReply: true });
            const missionId = missionMessage.id;
            
            activeMissions.set(missionId, missionData);
            await interaction.editReply(buildMissionMessage(missionId, missionData));
            sessionCache.delete(sessionId);

            try {
                const gm = await client.users.fetch(missionData.gmId);
                await gm.send(buildGmPanel(missionId, missionData));
            } catch (error) {
                console.log("DM do mestre fechada.");
            }
        }

        if (interaction.customId.startsWith('editmodal_')) {
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Missão expirada.', ephemeral: true });

            let vagas = parseInt(interaction.fields.getTextInputValue('vagas'));
            if (isNaN(vagas) || vagas < 1) vagas = 1;
            if (vagas > 6) vagas = 6;

            m.nome = interaction.fields.getTextInputValue('nome');
            m.dataHora = interaction.fields.getTextInputValue('data_hora');
            m.vagasTotais = vagas;
            m.enredo = interaction.fields.getTextInputValue('enredo');
            m.obs = interaction.fields.getTextInputValue('observacoes') || 'Nenhuma.';

            try {
                const guild = await client.guilds.fetch(m.guildId);
                const channel = await guild.channels.fetch(m.channelId);
                const msg = await channel.messages.fetch(missionId);
                await msg.edit(buildMissionMessage(missionId, m));
            } catch (e) {}

            await interaction.update(buildGmPanel(missionId, m));
        }
    }

    // === MENUS SUSPENSOS ===
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('selnd_') || interaction.customId.startsWith('seldif_')) {
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Missão expirada na memória.', ephemeral: true });

            if (interaction.customId.startsWith('selnd_')) m.nd = parseInt(interaction.values[0]);
            if (interaction.customId.startsWith('seldif_')) m.dif = interaction.values[0];

            try {
                const guild = await client.guilds.fetch(m.guildId);
                const channel = await guild.channels.fetch(m.channelId);
                const msg = await channel.messages.fetch(missionId);
                await msg.edit(buildMissionMessage(missionId, m));
            } catch (e) {}

            await interaction.update(buildGmPanel(missionId, m));
        }
    }

    // === BOTÕES ===
    if (interaction.isButton()) {
        
        if (interaction.customId.startsWith('edit_')) {
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Missão expirada.', ephemeral: true });

            const modal = new ModalBuilder().setCustomId(`editmodal_${missionId}`).setTitle('Editar Textos');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome').setStyle(TextInputStyle.Short).setValue(m.nome).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('data_hora').setLabel('Data e Hora').setStyle(TextInputStyle.Short).setValue(m.dataHora).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vagas').setLabel('Vagas (1 a 6)').setStyle(TextInputStyle.Short).setValue(m.vagasTotais.toString()).setMaxLength(1).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('enredo').setLabel('Enredo').setStyle(TextInputStyle.Paragraph).setValue(m.enredo).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('observacoes').setLabel('Observações').setStyle(TextInputStyle.Paragraph).setValue(m.obs).setRequired(false))
            );
            await interaction.showModal(modal);
        }

        if (interaction.customId.startsWith('complete_')) {
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Missão expirada.', ephemeral: true });

            m.concluida = true;

            try {
                const guild = await client.guilds.fetch(m.guildId);
                const channel = await guild.channels.fetch(m.channelId);
                const msg = await channel.messages.fetch(missionId);
                await msg.edit(buildMissionMessage(missionId, m));
            } catch (e) {}

            await interaction.update({ 
                content: `✅ **Missão Concluída!** O XP e Tibares foram calculados automaticamente no mural.\nLink do Mural: https://discord.com/channels/${m.guildId}/${m.channelId}/${missionId}`,
                embeds: buildMissionMessage(missionId, m).embeds,
                components: [] 
            });

            activeMissions.delete(missionId);
        }

        if (interaction.customId.startsWith('join_')) {
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            const playerId = interaction.user.id;

            if (!m) return interaction.reply({ content: "Missão expirada.", ephemeral: true });
            if (m.gmId === playerId) return interaction.reply({ content: "Você é o mestre!", ephemeral: true });
            if (m.jogadoresAceitos.includes(playerId)) return interaction.reply({ content: "Já está na missão!", ephemeral: true });

            try {
                const gm = await client.users.fetch(m.gmId);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`acc_${playerId}_${missionId}`).setLabel('Aceitar').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`rej_${playerId}_${missionId}`).setLabel('Recusar').setStyle(ButtonStyle.Danger)
                );

                await gm.send({
                    content: `🔔 <@${playerId}> quer participar da missão **${m.nome}**!\nLink: https://discord.com/channels/${m.guildId}/${m.channelId}/${missionId}`,
                    components: [row]
                });
                await interaction.reply({ content: "📩 Pedido enviado ao mestre!", ephemeral: true });
            } catch (error) {
                await interaction.reply({ content: "❌ O mestre fechou a DM.", ephemeral: true });
            }
        }

        if (interaction.customId.startsWith('acc_')) {
            const [, playerId, missionId] = interaction.customId.split('_');
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Erro: Missão expirada.', ephemeral: true });

            if (m.jogadoresAceitos.length < m.vagasTotais) {
                if (!m.jogadoresAceitos.includes(playerId)) m.jogadoresAceitos.push(playerId);
                
                try {
                    const guild = await client.guilds.fetch(m.guildId);
                    const channel = await guild.channels.fetch(m.channelId);
                    const msg = await channel.messages.fetch(missionId);
                    await msg.edit(buildMissionMessage(missionId, m));
                } catch (e) {}
                
                try {
                    const player = await client.users.fetch(playerId);
                    await player.send(`✅ Você foi **ACEITO** na missão **${m.nome}**!`);
                } catch(e) {}

                const remBtn = new ButtonBuilder().setCustomId(`rem_${playerId}_${missionId}`).setLabel('Remover Jogador').setStyle(ButtonStyle.Secondary);
                await interaction.update({ content: `✅ <@${playerId}> aceito!`, components: [new ActionRowBuilder().addComponents(remBtn)] });
            } else {
                await interaction.update({ content: `❌ Missão lotada!`, components: [] });
            }
        }

        if (interaction.customId.startsWith('rej_')) {
            const [, playerId] = interaction.customId.split('_');
            try {
                const player = await client.users.fetch(playerId);
                await player.send(`❌ O mestre recusou a sua participação desta vez.`);
            } catch(e) {}
            await interaction.update({ content: `🚫 <@${playerId}> recusado.`, components: [] });
        }

        if (interaction.customId.startsWith('rem_')) {
            const [, playerId, missionId] = interaction.customId.split('_');
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Erro: Missão expirada.', ephemeral: true });

            m.jogadoresAceitos = m.jogadoresAceitos.filter(id => id !== playerId);

            try {
                const guild = await client.guilds.fetch(m.guildId);
                const channel = await guild.channels.fetch(m.channelId);
                const msg = await channel.messages.fetch(missionId);
                await msg.edit(buildMissionMessage(missionId, m));
            } catch (e) {}

            try {
                const player = await client.users.fetch(playerId);
                await player.send(`ℹ️ Você foi removido da missão **${m.nome}** e sua vaga foi liberada.`);
            } catch(e) {}

            await interaction.update({ content: `✅ Jogador removido. Vaga liberada!`, components: [] });
        }
    }
});

// --- SISTEMA PARA MANTER O BOT ONLINE NO RENDER ---
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('O Bot do Mural de RPG está online e operante!'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor web de mentirinha rodando na porta ${port}`));

client.login(token);

