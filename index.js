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
const CARGO_JOGADORES_ID = '1475300658923045128';

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel] 
});

// Bancos de Memória
const sessionCache = new Map();
const activeMissions = new Map();
const gmActiveMissions = new Set(); // Controle para o mestre não ter mais de 1 missão ativa

// --- SISTEMA DE RECOMPENSAS ---
const tabelaRecompensas = {
    1: { xp: 500, dinheiro: 65 }, 2: { xp: 950, dinheiro: 97 }, 3: { xp: 1400, dinheiro: 130 }, 4: { xp: 1700, dinheiro: 325 },
    5: { xp: 2150, dinheiro: 487 }, 6: { xp: 2400, dinheiro: 650 }, 7: { xp: 2650, dinheiro: 812 }, 8: { xp: 2850, dinheiro: 975 },
    9: { xp: 3200, dinheiro: 1300 }, 10: { xp: 3350, dinheiro: 1950 }, 11: { xp: 3650, dinheiro: 2600 }, 12: { xp: 3800, dinheiro: 3250 },
    13: { xp: 4100, dinheiro: 4225 }, 14: { xp: 4200, dinheiro: 5525 }, 15: { xp: 4300, dinheiro: 7150 }, 16: { xp: 4350, dinheiro: 10075 },
    17: { xp: 4650, dinheiro: 13000 }, 18: { xp: 4700, dinheiro: 16250 }, 19: { xp: 4950, dinheiro: 19500 }, 20: { xp: 6000, dinheiro: 23400 }
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
    
    // Pinga o cargo apenas se a missão estiver ativa (não concluída nem falha)
    const mencao = (CARGO_JOGADORES_ID && !m.concluida && !m.falha) ? `<@&${CARGO_JOGADORES_ID}>\n\n` : '';
    
    let statusTag = '';
    let corEmbed = '#1C1C28';
    if (m.concluida) {
        statusTag = `✅ **[MISSÃO CONCLUÍDA]**\n\n`;
        corEmbed = '#2ECC71';
    } else if (m.falha) {
        statusTag = `❌ **[MISSÃO FALHOU]**\n\n`;
        corEmbed = '#E74C3C';
    }
    
    // Lógica para mostrar "ND 15 - 16 - 17"
    const ndMin = Math.max(1, m.nd - 1);
    const ndMax = Math.min(20, m.nd + 1);
    const faixaNd = [];
    for (let i = ndMin; i <= ndMax; i++) {
        faixaNd.push(i);
    }
    const textoNd = `ND ${faixaNd.join(' - ')}`;
    
    const content = `${mencao}${statusTag}- **Missão:** ${m.nome}\n- **Data e Hora:** ${m.dataHora}\n- **Mestre:** <@${m.gmId}>\n- **Nível de Desafio:** ${textoNd}\n- **Dificuldade:** ${modificadores[m.dif].nome}\n\n**Vagas:** ${m.jogadoresAceitos.length}/${m.vagasTotais}\n${listaVagas.join('\n')}`;
    
    const embed = new EmbedBuilder().setColor(corEmbed).addFields(
        { name: 'Estilo de Jogo e Enredo', value: m.enredo, inline: false },
        { name: 'Observações', value: m.obs, inline: false }
    );

    // Cálculos prévios
    const xpBase = tabelaRecompensas[m.nd].xp;
    const dinBase = tabelaRecompensas[m.nd].dinheiro;
    const mult = modificadores[m.dif].mult;
    const xpFinal = Math.floor(xpBase * mult);
    const dinFinal = Math.floor(dinBase * mult);

    if (!m.concluida && !m.falha) {
        // Exibe recompensa esperada no rodapé apenas enquanto ativa
        embed.setFooter({ text: `Recompensa: ${xpFinal} XP | T$ ${dinFinal} (ND ${m.nd})` });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`join_${missionId}`).setLabel('Participar').setStyle(ButtonStyle.Primary)
        );
        return { content, embeds: [embed], components: [row] };
    } else {
        // Missão encerrada (Sucesso ou Falha)
        const xpJogadores = m.falha ? Math.floor(xpFinal / 2) : xpFinal;
        const dinJogadores = m.falha ? Math.floor(dinFinal / 2) : dinFinal;
        
        const xpMestre = Math.floor(xpFinal / 2);
        const dinMestre = Math.floor(dinFinal / 2);

        embed.addFields(
            { name: '🎁 Recompensas dos Jogadores', value: `**XP:** ${xpJogadores}\n**Dinheiro:** T$ ${dinJogadores}`, inline: true },
            { name: '👑 Recompensa do Mestre', value: `**XP:** ${xpMestre}\n**Dinheiro:** T$ ${dinMestre}`, inline: true }
        );
        return { content, embeds: [embed], components: [] };
    }
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
        new ButtonBuilder().setCustomId(`complete_${missionId}`).setLabel('✅ Concluir').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`fail_${missionId}`).setLabel('❌ Falhar').setStyle(ButtonStyle.Danger)
    );

    return {
        content: `📝 **Painel do Mestre**\nUse os menus abaixo para configurar os aspectos de sistema, ou edite os textos da missão.\nLink do Mural: https://discord.com/channels/${m.guildId}/${m.channelId}/${missionId}`,
        embeds: buildMissionMessage(missionId, m).embeds,
        components: [rowNd, rowDif, rowBtns]
    };
}

const ndChoices = Array.from({ length: 20 }, (_, i) => ({ name: `ND ${i + 1}`, value: i + 1 }));
const vagasChoices = Array.from({ length: 6 }, (_, i) => ({ name: `${i + 1} Vaga(s)`, value: i + 1 }));

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
        .addIntegerOption(opt => opt.setName('vagas').setDescription('Quantidade de Vagas').setRequired(true).addChoices(...vagasChoices)),
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
            if (gmActiveMissions.has(interaction.user.id)) {
                return interaction.reply({ content: '❌ Você já possui uma missão ativa! Conclua ou marque como falha a atual no seu PV antes de criar outra.', ephemeral: true });
            }

            const nd = interaction.options.getInteger('nd');
            const dif = interaction.options.getString('dificuldade');
            const vagas = interaction.options.getInteger('vagas');
            const sessionId = interaction.id;
            
            sessionCache.set(sessionId, { nd, dif, vagas });

            const modal = new ModalBuilder().setCustomId(`modal_missao_${sessionId}`).setTitle('Criar Missão');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome da Missão').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('data_hora').setLabel('Data e Hora').setPlaceholder('Ex: Sábado às 20h, Amanhã 19:00...').setStyle(TextInputStyle.Short).setRequired(true)),
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
            const sessionData = sessionCache.get(sessionId) || { nd: 1, dif: 'normal', vagas: 4 };

            const missionData = {
                gmId: interaction.user.id,
                guildId: interaction.guild.id,
                channelId: interaction.channel.id,
                nd: sessionData.nd,
                dif: sessionData.dif,
                dataHora: interaction.fields.getTextInputValue('data_hora'),
                nome: interaction.fields.getTextInputValue('nome'),
                vagasTotais: sessionData.vagas,
                enredo: interaction.fields.getTextInputValue('enredo'),
                obs: interaction.fields.getTextInputValue('observacoes') || 'Nenhuma.',
                jogadoresAceitos: [],
                concluida: false,
                falha: false
            };
            
            gmActiveMissions.add(interaction.user.id);

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
            if (!m) return interaction.reply({ content: 'Missão expirada na memória.', ephemeral: true });

            m.nome = interaction.fields.getTextInputValue('nome');
            m.dataHora = interaction.fields.getTextInputValue('data_hora');
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
            if (!m) return interaction.reply({ content: 'Missão expirada na memória.', ephemeral: true });

            const modal = new ModalBuilder().setCustomId(`editmodal_${missionId}`).setTitle('Editar Textos');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome').setStyle(TextInputStyle.Short).setValue(m.nome).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('data_hora').setLabel('Data e Hora').setStyle(TextInputStyle.Short).setValue(m.dataHora).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('enredo').setLabel('Enredo').setStyle(TextInputStyle.Paragraph).setValue(m.enredo).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('observacoes').setLabel('Observações').setStyle(TextInputStyle.Paragraph).setValue(m.obs).setRequired(false))
            );
            await interaction.showModal(modal);
        }

        if (interaction.customId.startsWith('complete_') || interaction.customId.startsWith('fail_')) {
            const isFail = interaction.customId.startsWith('fail_');
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            if (!m) return interaction.reply({ content: 'Missão expirada na memória.', ephemeral: true });

            if (isFail) m.falha = true;
            else m.concluida = true;

            gmActiveMissions.delete(m.gmId); // Libera o mestre

            const msgData = buildMissionMessage(missionId, m);

            try {
                const guild = await client.guilds.fetch(m.guildId);
                const channel = await guild.channels.fetch(m.channelId);
                const msg = await channel.messages.fetch(missionId);
                await msg.edit(msgData);
            } catch (e) {}

            // Atualiza o painel na DM replicando as recompensas exatamente igual ao mural
            await interaction.update({ 
                content: isFail ? `❌ **Missão marcada como falha!** O mural foi atualizado.\nLink: https://discord.com/channels/${m.guildId}/${m.channelId}/${missionId}` : `✅ **Missão Concluída!** O mural foi atualizado.\nLink: https://discord.com/channels/${m.guildId}/${m.channelId}/${missionId}`,
                embeds: msgData.embeds,
                components: [] 
            });

            activeMissions.delete(missionId);
        }

        if (interaction.customId.startsWith('join_')) {
            const missionId = interaction.customId.split('_')[1];
            const m = activeMissions.get(missionId);
            const playerId = interaction.user.id;

            if (!m) return interaction.reply({ content: "Missão expirada na memória.", ephemeral: true });
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
            if (!m) return interaction.reply({ content: 'Erro: Missão expirada na memória.', ephemeral: true });

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
            if (!m) return interaction.reply({ content: 'Erro: Missão expirada na memória.', ephemeral: true });

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
