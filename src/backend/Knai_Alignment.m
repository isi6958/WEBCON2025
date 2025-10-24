clc,clear;

% --- 設定 ---
ptCloudFiles = {
    'C:\Users\takut\Documents\ACRS\web\visualSfM\OpenSfm_Ref_cluster.ply' 
    'C:\Users\takut\Documents\ACRS\web\visualSfM\OpenSfm_zako_cluster.ply'   
};
maxDistance = 0.02;

% --- 点群格納用変数 ---
alignedPtClouds = cell(1, length(ptCloudFiles));

for i = 1:length(ptCloudFiles)
    % 点群の読み込み
    ptCloud = pcread(ptCloudFiles{i});
    
    % 平面検出
    [model, ~, ~] = pcfitplane(ptCloud, maxDistance);
    
    % 回転計算
    planeNormal = model.Normal;

    if planeNormal(3) > 0  % Zが上を向いていたら反転
        planeNormal = -planeNormal;
    end

    zAxis = [0 0 -1];
    rotationAxis = cross(planeNormal, zAxis);
    rotationAngle = acos(dot(planeNormal, zAxis));

    rotationMatrix = axang2rotm([rotationAxis/norm(rotationAxis), rotationAngle]);
    
    % 点群回転
    tform = rigidtform3d(rotationMatrix, [0 0 0]);
    ptCloudAligned = pctransform(ptCloud, tform);
    
    % 結果を格納
    alignedPtClouds{i} = ptCloudAligned;
end

% --- 変数に代入 ---
ptCloudRef = alignedPtClouds{1};
ptCloudTarget = alignedPtClouds{2};

% --- 確認表示 ---
figure;
subplot(1,2,1); pcshow(ptCloudRef); title('refPtCloud'); axis equal;
subplot(1,2,2); pcshow(ptCloudTarget); title('targetPtCloud'); axis equal;

disp('refPtCloud と targetPtCloud の準備が完了しました。');


% --- 基準点群 (Reference) からマーカー4点を選択 ---
disp('【基準点群】でマーカーとなる4点をクリックしてください。');
figure;
pcshow(ptCloudRef);
title('【基準】マーカーを4点選択 (クリック後 Enter)');
xlabel('X');
ylabel('Y');
zlabel('Z');
view(0, 90);
hold on;

dcm_obj_ref = datacursormode(gcf);
datacursormode on;
movingPoints = zeros(4, 3);  % 基準の4点を保存

for i = 1:4
    disp(['基準点 ', num2str(i), '/4 を選択して Enter キーを押してください']);
    pause;  % ユーザーの操作（クリック＋Enter）を待機
    
    c_info = getCursorInfo(dcm_obj_ref);
    if isempty(c_info)
        disp('点が選択されませんでした。もう一度試してください。');
        i = i - 1; % カウンタを戻す
        continue;
    end
    
    movingPoints(i, :) = c_info.Position;
    
    % 選択した点を視覚化
    plot3(movingPoints(i, 1), movingPoints(i, 2), movingPoints(i, 3), ...
          'r*', 'MarkerSize', 10, 'LineWidth', 2);
    disp(['基準点 ', num2str(i), ': [', num2str(movingPoints(i, :)), '] を取得。']);
end

hold off;
datacursormode off;
close(gcf); % 基準点群のウィンドウを閉じる
disp('基準の4点を選択しました。');


% ---  対象点群 (Target) からマーカー4点を選択 ---
disp('【対象点群】で対応するマーカー4点を「同じ順序」でクリックしてください。');
figure;
pcshow(ptCloudTarget);
title('【対象】対応するマーカーを4点選択 (クリック後 Enter)');
xlabel('X');
ylabel('Y');
zlabel('Z');
view(0, 90);
hold on;

dcm_obj_target = datacursormode(gcf);
datacursormode on;
fixedPoints = zeros(4, 3);  % 対象の4点を保存

for i = 1:4
    disp(['対象点 ', num2str(i), '/4 を選択して Enter キーを押してください']);
    pause;  % ユーザーの操作（クリック＋Enter）を待機
    
    c_info = getCursorInfo(dcm_obj_target);
     if isempty(c_info)
        disp('点が選択されませんでした。もう一度試してください。');
        i = i - 1; % カウンタを戻す
        continue;
    end
    
    fixedPoints(i, :) = c_info.Position;
    
    % 選択した点を視覚化
    plot3(fixedPoints(i, 1), fixedPoints(i, 2), fixedPoints(i, 3), ...
          'g*', 'MarkerSize', 10, 'LineWidth', 2);
    disp(['対象点 ', num2str(i), ': [', num2str(fixedPoints(i, :)), '] を取得。']);
end

hold off;
datacursormode off;
close(gcf); % 対象点群のウィンドウを閉じる
disp('対象の4点を選択しました。');


% --- 変換の計算 ---
% 選択された対応点 (fixedPoints と movingPoints) を使って、
% Target(fixed) を Reference(moving) に合わせるための変換を推定します。

% スケールが合っていない場合は 'similarity' を使用
transformType = 'similarity'; % または 'rigid'

tform = estimateGeometricTransform3D(fixedPoints, movingPoints, transformType);

% --- 点群の変換 ---
% 推定した変換行列 (tform) を使って、Target点群全体を変換します。
ptCloudTargetAligned = pctransform(ptCloudTarget, tform);

% ---  結果の可視化 ---
disp('位置合わせが完了しました。結果を表示します。');
figure;
ax = pcshowpair(ptCloudRef, ptCloudTargetAligned, ...
    'MarkerSize', 50, 'VerticalAxis', 'Z');

title('手動位置合わせの結果');
xlabel('X');
ylabel('Y');
zlabel('Z');
legend({'基準点群 (Reference)', '位置合わせ後の対象点群 (Target)'}, 'Location', 'northeast');

disp('処理完了。');

% ICPの実行
% ptCloudMoving を ptCloudFixed に合わせ込みます。
% tform: 推定された変換行列 (4x4)
% ptCloudMovingReg: 変換後の移動点群
[tform, ptCloudMovingReg] = pcregistericp(ptCloudTargetAligned, ptCloudRef,...
    'Metric', 'pointToPlane', ...
    'MaxIterations', 200, ...
    'Tolerance', [1e-6, 1e-6]);

%  結果の可視化
figure;
% 実行前の状態 (緑が移動点群)
pcshowpair(ptCloudRef, ptCloudTargetAligned, 'MarkerSize', 30);
title('ICP 実行前');
legend({'固定点群 (Fixed)', '移動点群 (Moving)'}, 'Location', 'southoutside');

figure;
% 実行後の状態 (緑が位置合わせされた点群)
pcshowpair(ptCloudRef, ptCloudMovingReg, 'MarkerSize', 30);
title('ICP 実行後');
legend({'固定点群 (Fixed)', '位置合わせ後の点群 (Registered)'}, 'Location', 'southoutside');

% 推定された変換行列を表示
disp('推定された変換行列 (tform):');
disp(tform.A);

%　メッシュ化
polygonVertices_Ref = movingPoints(:, 1:2);  % XYだけ抽出
points = ptCloudRef.Location;  % Nx3の行列 [X, Y, Z]
in_Ref = inpolygon(points(:,1), points(:,2), polygonVertices_Ref(:,1), polygonVertices_Ref(:,2));
ptCloud_sub_Ref = select(ptCloudRef, find(in_Ref));
mesh_sub_Ref = pc2surfacemesh(ptCloud_sub_Ref, "poisson", 12);
surfaceMeshShow(mesh_sub_Ref);

%　Fixメッシュ化
points_Fix = ptCloudMovingReg.Location;  
in_Fix = inpolygon(points_Fix(:,1), points_Fix(:,2), polygonVertices_Ref(:,1), polygonVertices_Ref(:,2));
ptCloud_sub_Fix = select(ptCloudMovingReg, find(in_Fix));
mesh_sub_Fix = pc2surfacemesh(ptCloud_sub_Fix, "poisson", 12);
surfaceMeshShow(mesh_sub_Fix);


%　　精度評価
% --- mesh_sub_Ref の表面積 ---
faces = mesh_sub_Ref.Faces;      % 三角形の頂点インデックス
vertices = mesh_sub_Ref.Vertices; % 各頂点の3D座標

% 各三角形の3辺を求めて面積を計算
v1 = vertices(faces(:,1), :);
v2 = vertices(faces(:,2), :);
v3 = vertices(faces(:,3), :);

% 各三角形の面積 = 0.5 * |(v2 - v1) × (v3 - v1)|
A_ref = 0.5 * vecnorm(cross(v2 - v1, v3 - v1, 2), 2, 2);
Area_3D_ref = sum(A_ref);

% --- 同様に mesh_sub_Fix の表面積 ---
faces = mesh_sub_Fix.Faces;
vertices = mesh_sub_Fix.Vertices;
v1 = vertices(faces(:,1), :);
v2 = vertices(faces(:,2), :);
v3 = vertices(faces(:,3), :);

A_fix = 0.5 * vecnorm(cross(v2 - v1, v3 - v1, 2), 2, 2);
Area_3D_fix = sum(A_fix);

fprintf('Refメッシュの表面積: %.3f\n', Area_3D_ref);
fprintf('Fixメッシュの表面積: %.3f\n', Area_3D_fix);

N_inside_ref = ptCloud_sub_Ref.Count;
density_ref = N_inside_ref / Area_3D_ref;

N_inside_fix = ptCloud_sub_Fix.Count;
density_fix = N_inside_fix / Area_3D_fix;


% ---  ICPベースの精度評価 (RMSE) ---
disp('ICP後の点群間距離 (RMSE) を計算中...');

[~, dists] = findNearestNeighbors(ptCloudRef, ptCloudMovingReg.Location,1);

% RMSE (二乗平均平方根誤差) を計算します
rmse = sqrt(mean(dists.^2));

% ---  結果の表示 ---
fprintf('--- ICP 精度評価 (RMSE) ---\n');
fprintf('RMSE (点群間距離): %.6f\n', rmse);

% 単位についての補足
disp('mm');

%% 
% --- パラメータ設定 ---
alpha = 50;              % RMSEスケーリング係数（単位に応じて調整）
w_N = 0.3; w_density = 0.3; w_RMSE = 0.4;  % 重み設定（合計=1）

% --- 入力値（前段の処理から得られている） ---
% N_inside_ref, N_inside_fix
% density_ref, density_fix
% rmse

% --- 各スコア計算（0〜100%） ---
score_N = (N_inside_fix / N_inside_ref) * 100;
score_density = (density_fix / density_ref) * 100;
score_RMSE = 100 * exp(-rmse / alpha);

% --- スコアの上限・下限補正 ---
score_N = min(max(score_N, 0), 100);
score_density = min(max(score_density, 0), 100);
score_RMSE = min(max(score_RMSE, 0), 100);

% --- 総合スコア計算 ---
total_score = w_N * score_N + w_density * score_density + w_RMSE * score_RMSE;

% --- 結果の表示 ---
fprintf('\n--- 点群モデル評価スコア ---\n');
fprintf('点群数スコア (S_N)       : %.2f %%\n', score_N);
fprintf('点密度スコア (S_ρ)       : %.2f %%\n', score_density);
fprintf('RMSEスコア (S_RMSE)      : %.2f %%\n', score_RMSE);
fprintf('---------------------------------\n');
fprintf('総合スコア (S_total)      : %.2f %%\n', total_score);