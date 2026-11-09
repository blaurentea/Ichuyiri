% PROYECTO SIKURI - EXPLORACION DE SUB-BANDAS (BASELINE V1)
clear; clc; close all;

[x, Fs] = audioread('AUDIO_2.mpeg');

if size(x,2) == 2
    x = mean(x,2);
end

inicio = 10;
fin = 20;

x = x(round(inicio*Fs)+1:round(fin*Fs));

t = (0:length(x)-1)/Fs;

filtro1 = bandpass(x,[30 80],Fs);
filtro2 = bandpass(x,[80 150],Fs);
filtro3 = bandpass(x,[150 250],Fs);

figure;

subplot(4,1,1);
plot(t,x);
title('Audio original');
ylabel('Amplitud');
grid on;

subplot(4,1,2);
plot(t,filtro1);
title('Banda 30 - 80 Hz');
ylabel('Amplitud');
grid on;

subplot(4,1,3);
plot(t,filtro2);
title('Banda 80 - 150 Hz');
ylabel('Amplitud');
grid on;

subplot(4,1,4);
plot(t,filtro3);
title('Banda 150 - 250 Hz');
xlabel('Tiempo relativo (s)');
ylabel('Amplitud');
grid on;

soundsc(filtro1,Fs);
pause(length(filtro1)/Fs + 1);

soundsc(filtro2,Fs);
pause(length(filtro2)/Fs + 1);

soundsc(filtro3,Fs);

