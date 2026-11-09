%% PROYECTO SIKURI - DETECTOR DE BOMBO V1 (BASELINE MATLAB)

clear; clc; close all;

[x, Fs] = audioread('AUDIO_2.mpeg');

% Convertir a mono
if size(x,2) == 2
    x = mean(x,2);
end

%% 2. Seleccionar 15 segundos
inicio = 10;
fin = min(25, length(x)/Fs);

x = x(round(inicio*Fs)+1:round(fin*Fs));

%% 3. Filtro pasa-banda
% Frecuencias elegidas experimentalmente
x_filtro = bandpass(x,[80 150],Fs);

%% 4. Calcular envolvente RMS
% Ventana de 30 ms
ventana = max(1,round(0.030*Fs));

energia = sqrt(movmean(x_filtro.^2,ventana));

%% 5. Detectar picos
% Distancia minima: 0.20 segundos
distancia = round(0.20*Fs);

[picos, posiciones] = findpeaks(energia, ...
    'MinPeakProminence',0.15*max(energia), ...
    'MinPeakDistance',distancia);

%% 6. Convertir posiciones a tiempo
tiempos = (posiciones-1)/Fs + inicio;

%% 7. Mostrar resultados
t = (0:length(x)-1)/Fs + inicio;

figure;
plot(t,energia,'b');
hold on;
plot(tiempos,picos,'ro','MarkerFaceColor','r');

xlabel('Tiempo (s)');
ylabel('Energia RMS');
title('Deteccion de posibles golpes de bombo');
legend('Envolvente RMS','Picos detectados');
grid on;

%% 8. Imprimir tiempos
disp('Posibles golpes detectados:');

for i = 1:length(tiempos)
    fprintf('Golpe %d: %.3f segundos\n', ...
        i,tiempos(i));
end

%% 9. Reproducir cancion y mostrar golpes

% Crear reproductor
player = audioplayer(x, Fs);

% Crear ventana
figure;
h = plot(t, energia, 'b');
hold on;

% Indicador del instante actual
linea = xline(t(1), 'g', 'LineWidth', 1.5);

% Marcador del golpe detectado
marcador = plot(NaN, NaN, 'ro', ...
    'MarkerFaceColor', 'r', 'MarkerSize', 9);

titulo = title('Esperando reproduccion...');

xlabel('Tiempo (s)');
ylabel('Energia RMS');
grid on;

% Reproducir sin interrupciones
play(player);

ultimoGolpe = 0;

while isplaying(player)

    % Obtener posicion de reproduccion
    muestra = player.CurrentSample;
    tiempoActual = inicio + (muestra-1)/Fs;

    % Mover indicador temporal
    linea.Value = tiempoActual;

    % Detectar golpes alcanzados
    while ultimoGolpe < length(tiempos) && ...
          tiempos(ultimoGolpe+1) <= tiempoActual

        ultimoGolpe = ultimoGolpe + 1;

        % Mostrar golpe en la grafica
        set(marcador, ...
            'XData', tiempos(ultimoGolpe), ...
            'YData', picos(ultimoGolpe));

        titulo.String = sprintf( ...
            'GOLPE DETECTADO - %.2f s', ...
            tiempos(ultimoGolpe));

        fprintf('Golpe detectado: %.2f s\n', ...
            tiempos(ultimoGolpe));
    end

    drawnow limitrate;
    pause(0.02);
end

